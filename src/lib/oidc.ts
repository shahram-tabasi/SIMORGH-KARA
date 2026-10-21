import "server-only";
import { createHash, randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Sign-in with Keycloak (realm `kara`), OpenID Connect code flow with PKCE.
 * kara-web stays the place that decides who someone is in Kara: Keycloak
 * proves the email address, and the Kara account with that address gets
 * the same session as a password login (src/lib/login.ts).
 *
 *   KEYCLOAK_ISSUER         https://auth.simorghai.com/realms/kara (the browser's address)
 *   KEYCLOAK_INTERNAL_URL   the same realm inside the cluster (tokens, keys); optional
 *   KEYCLOAK_CLIENT_ID      kara-web
 *   KEYCLOAK_CLIENT_SECRET  from Secret kara-keycloak
 *   APP_URL                 https://kara.simorghai.com (redirect URIs)
 *   PASSWORD_LOGIN          "true" keeps Kara's own password form beside it
 */

const trim = (u: string) => u.replace(/\/+$/, "");

export function oidcConfig() {
  const issuer = trim(process.env.KEYCLOAK_ISSUER ?? "");
  const secret = process.env.KEYCLOAK_CLIENT_SECRET ?? "";
  if (!issuer || !secret) return null;
  return {
    issuer,
    internal: trim(process.env.KEYCLOAK_INTERNAL_URL || issuer),
    clientId: process.env.KEYCLOAK_CLIENT_ID || "kara-web",
    secret,
  };
}

export const oidcEnabled = () => oidcConfig() !== null;

/** Kara's own password login: always without Keycloak, beside it only when asked for. */
export const passwordLoginEnabled = () => !oidcEnabled() || process.env.PASSWORD_LOGIN === "true";

export function appUrl(request: Request): string {
  if (process.env.APP_URL) return trim(process.env.APP_URL);
  const h = request.headers;
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host;
  return `${proto}://${host}`;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** What the browser keeps (httpOnly, 10 minutes) between leaving for Keycloak and coming back. */
export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  next?: string;
}

export function newPendingLogin(next?: string): PendingLogin {
  return { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), next };
}

export function authorizeUrl(p: PendingLogin, redirectUri: string, opts: { organization?: string; loginHint?: string } = {}): string {
  const c = oidcConfig()!;
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    // `organization:<alias>` asks Keycloak to sign in for that organization
    // (a tenant's own login page); its identity provider, if any, is offered.
    scope: ["openid", "email", "profile", opts.organization ? `organization:${opts.organization}` : ""].filter(Boolean).join(" "),
    state: p.state,
    nonce: p.nonce,
    code_challenge: b64url(createHash("sha256").update(p.verifier).digest()),
    code_challenge_method: "S256",
    ui_locales: "fa",
  });
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `${c.issuer}/protocol/openid-connect/auth?${q}`;
}

export interface IdClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** Code → tokens (from inside the cluster), and the ID token checked: signature, issuer, audience, nonce. */
export async function finishLogin(code: string, p: PendingLogin, redirectUri: string): Promise<{ claims: IdClaims; idToken: string }> {
  const c = oidcConfig()!;
  const res = await fetch(`${c.internal}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: c.clientId,
      client_secret: c.secret,
      code_verifier: p.verifier,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token endpoint: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error("no id_token in the token response");
  jwks ??= createRemoteJWKSet(new URL(`${c.internal}/protocol/openid-connect/certs`));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: c.issuer, audience: c.clientId });
  const claims = payload as IdClaims;
  if (claims.nonce !== p.nonce) throw new Error("nonce mismatch");
  return { claims, idToken };
}

/** Keycloak's logout, which ends the single sign-on too, then back to /login. */
export function logoutUrl(idToken: string | undefined, postLogout: string): string {
  const c = oidcConfig()!;
  const q = new URLSearchParams({ post_logout_redirect_uri: postLogout, client_id: c.clientId });
  if (idToken) q.set("id_token_hint", idToken);
  return `${c.issuer}/protocol/openid-connect/logout?${q}`;
}

/** Keycloak's account page: password, sessions, two-factor. */
export function accountUrl(): string | null {
  const c = oidcConfig();
  return c ? `${c.issuer}/account/` : null;
}
