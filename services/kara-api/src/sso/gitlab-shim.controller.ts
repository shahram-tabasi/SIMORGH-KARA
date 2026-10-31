import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Res, UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { verifyToken } from '../auth/keycloak';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { teamEvents } from '../infra/metrics';
import { usernameFor } from '../team/mattermost.client';
import { gitlabIdOf, TeamAccessService } from '../team/team-access.service';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => randomBytes(n).toString('base64url');
const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The OAuth clients (Plane, Mattermost) that may use the adapter. Exported for tests. */
export function clientFor(id: string | undefined) {
  return config.team.sso.clients.find((c) => c.id === id && c.secret);
}

/** A redirect the client registered (prefix match on an exact origin and path). Exported for tests. */
export function redirectAllowed(prefix: string, uri: string): boolean {
  try {
    const p = new URL(prefix); const u = new URL(uri);
    return u.origin === p.origin && u.pathname.replace(/\/+$/, '') === p.pathname.replace(/\/+$/, '');
  } catch { return false; }
}

/**
 * Kara's "GitLab" for Plane and Mattermost (docs/TEAM-PLATFORM.md §3): their
 * free editions sign in with GitLab OAuth only, so Kara answers the four calls
 * they make and signs the person in with Keycloak (realm kara, client
 * kara-team-sso: one password, Keycloak's MFA).
 *
 *   GET  /sso/gitlab/oauth/authorize  browser: → Keycloak → /callback → back to the app with a code
 *   POST /sso/gitlab/oauth/token      the app: code → access token (client secret required)
 *   GET  /sso/gitlab/api/v4/user      the app: who is it (GitLab's user shape)
 *
 * Only a person Kara gives the app may get through (team-access.service): a
 * former employee's Keycloak password opens nothing here.
 */
@Controller('sso/gitlab')
export class GitlabShimController {
  private readonly log = new Logger(GitlabShimController.name);

  constructor(private readonly db: DbService, private readonly access: TeamAccessService) {}

  private keycloak(path: 'auth' | 'token') {
    const base = path === 'auth' ? config.keycloak.issuer : (config.keycloak.internalUrl || config.keycloak.issuer);
    return `${base}/protocol/openid-connect/${path}`;
  }

  @Get('oauth/authorize')
  async authorize(@Query() q: Record<string, string>, @Res() res: Response) {
    const client = clientFor(q.client_id);
    if (!client) throw new BadRequestException('unknown client');
    if (!q.redirect_uri || !redirectAllowed(client.redirectPrefix, q.redirect_uri)) throw new BadRequestException('redirect_uri not allowed');
    if (!config.team.sso.keycloakClientSecret) throw new BadRequestException('the sign-in adapter is not configured');
    const state = rand(24);
    const verifier = rand(48);
    await this.db.query(`DELETE FROM kara_team.sso_pending WHERE expires_at < now()`);
    await this.db.query(`INSERT INTO kara_team.sso_pending (state, client_id, redirect_uri, client_state, code_verifier, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`, [state, client.id, q.redirect_uri, q.state ?? null, verifier]);
    const url = new URL(this.keycloak('auth'));
    url.search = new URLSearchParams({
      client_id: config.team.sso.keycloakClientId, response_type: 'code', scope: 'openid email profile',
      redirect_uri: `${config.team.sso.publicBase}/callback`, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, url.toString());
  }

  @Get('callback')
  async callback(@Query() q: Record<string, string>, @Res() res: Response) {
    const [p] = await this.db.query<{ client_id: string; redirect_uri: string; client_state: string | null; code_verifier: string }>(
      `DELETE FROM kara_team.sso_pending WHERE state = $1 AND expires_at > now() RETURNING client_id, redirect_uri, client_state, code_verifier`,
      [q.state ?? '']);
    if (!p) return this.page(res, 400, 'این ورود منقضی شده است. دوباره از برنامه وارد شوید.', 'This sign-in has expired; start again from the app.');
    const back = (params: Record<string, string>) => {
      const u = new URL(p.redirect_uri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (p.client_state) u.searchParams.set('state', p.client_state);
      return res.redirect(302, u.toString());
    };
    if (q.error || !q.code) return back({ error: 'access_denied' });

    const tr = await fetch(this.keycloak('token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: q.code, redirect_uri: `${config.team.sso.publicBase}/callback`,
        client_id: config.team.sso.keycloakClientId, client_secret: config.team.sso.keycloakClientSecret, code_verifier: p.code_verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tr.ok) {
      this.log.warn(`keycloak code exchange: HTTP ${tr.status}`);
      return back({ error: 'server_error' });
    }
    const { access_token } = (await tr.json()) as { access_token: string };
    const claims = await verifyToken(access_token);
    if (!claims.email || claims.email_verified !== true) return back({ error: 'access_denied' });

    const client = config.team.sso.clients.find((c) => c.id === p.client_id)!;
    const who = await this.access.byEmail(claims.email, client.app);
    if (!who) {
      teamEvents.inc({ source: `sso_${client.app}`, outcome: 'denied' });
      this.log.log(`sso ${client.app}: ${claims.email} has no access`);
      return this.page(res, 403,
        `دسترسی شما به ${client.app === 'plane' ? 'Plane (پروژه‌ها)' : 'Mattermost (گفتگوی تیمی)'} در کارا فعال نیست. از مدیر شرکت بخواهید آن را در کارا برایتان روشن کند.`,
        `Kara has not given you ${client.app}. Ask your company's admin to switch it on for you in Kara.`);
    }
    const code = rand(32);
    await this.db.query(`DELETE FROM kara_team.sso_grants WHERE expires_at < now() - interval '1 day'`);
    await this.db.query(`INSERT INTO kara_team.sso_grants (hash, kind, client_id, account_id, redirect_uri, expires_at)
      VALUES ($1, 'code', $2, $3, $4, now() + interval '2 minutes')`, [sha(code), client.id, who.accountId, p.redirect_uri]);
    teamEvents.inc({ source: `sso_${client.app}`, outcome: 'signed_in' });
    return back({ code });
  }

  /** GitLab's token endpoint: form or JSON body; client credentials in the body or Basic auth. */
  @Post('oauth/token')
  @HttpCode(200)
  async token(@Body() b: Record<string, string>, @Headers('authorization') auth?: string) {
    let clientId = b.client_id; let secret = b.client_secret;
    const basic = /^Basic\s+(.+)$/i.exec(auth ?? '');
    if (basic) {
      const [id, sec] = Buffer.from(basic[1], 'base64').toString().split(':');
      clientId = decodeURIComponent(id ?? ''); secret = decodeURIComponent(sec ?? '');
    }
    const client = clientFor(clientId);
    if (!client || !secret || !sameSecret(secret, client.secret)) throw new UnauthorizedException({ error: 'invalid_client' });
    if (b.grant_type !== 'authorization_code' || !b.code) throw new BadRequestException({ error: 'unsupported_grant_type' });
    const [g] = await this.db.query<{ account_id: string; redirect_uri: string | null }>(`
      UPDATE kara_team.sso_grants SET used_at = now()
      WHERE hash = $1 AND kind = 'code' AND client_id = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING account_id::text, redirect_uri`, [sha(b.code), client.id]);
    if (!g) throw new BadRequestException({ error: 'invalid_grant' });
    if (b.redirect_uri && g.redirect_uri && b.redirect_uri !== g.redirect_uri) throw new BadRequestException({ error: 'invalid_grant' });
    const token = rand(32);
    const ttl = config.team.sso.tokenTtlSeconds;
    await this.db.query(`INSERT INTO kara_team.sso_grants (hash, kind, client_id, account_id, expires_at)
      VALUES ($1, 'token', $2, $3, now() + make_interval(secs => $4))`, [sha(token), client.id, g.account_id, ttl]);
    return { access_token: token, token_type: 'bearer', expires_in: ttl, created_at: Math.floor(Date.now() / 1000), scope: 'read_user' };
  }

  /** GitLab's /api/v4/user, enough for Plane (id, email, name, confirmed_at) and Mattermost (id, username, email, name). */
  @Get('api/v4/user')
  async user(@Headers('authorization') auth?: string) {
    const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
    if (!m) throw new UnauthorizedException({ message: '401 Unauthorized' });
    const [g] = await this.db.query<{ account_id: string; client_id: string }>(`
      SELECT account_id::text, client_id FROM kara_team.sso_grants WHERE hash = $1 AND kind = 'token' AND expires_at > now()`, [sha(m[1])]);
    if (!g) throw new UnauthorizedException({ message: '401 Unauthorized' });
    const client = config.team.sso.clients.find((c) => c.id === g.client_id)!;
    const who = await this.access.byAccount(g.account_id, client.app);
    if (!who) throw new UnauthorizedException({ message: '401 Unauthorized' });
    const known = await this.access.identity(who.accountId, client.app);
    const username = known?.username ?? usernameFor(who.email);
    const [first, ...rest] = who.fullName.trim().split(/\s+/);
    return {
      id: gitlabIdOf(who.accountId),
      username,
      name: who.fullName,
      family_name: rest.join(' ') || undefined,
      first_name: first,
      email: who.email,
      state: 'active',
      confirmed_at: new Date(0).toISOString(),
      avatar_url: null,
      web_url: `${config.team.sso.publicBase}/${username}`,
    };
  }

  private page(res: Response, status: number, fa: string, en: string) {
    res.status(status).type('html').send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Kara</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#f9fafb;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;max-width:28rem;margin:16px}p.en{direction:ltr;color:#4b5563;font-size:14px}</style>
</head><body><main><p>${fa}</p><p class="en">${en}</p></main></body></html>`);
  }
}
