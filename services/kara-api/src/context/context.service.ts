import { ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, JWTPayload, jwtVerify } from 'jose';
import { config } from '../config';
import { ConnectorClient } from '../erp/connector.client';
import { DbService } from '../infra/db.service';
import { CompanyContext, CompanyServices, ContextApp, KnowledgeItem, chooseOrg, kindsFor, orgsOf } from './context';

interface AppToken extends JWTPayload { azp?: string; client_id?: string; organization?: unknown; preferred_username?: string }

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

/**
 * A company's context for one app (docs/INTEGRATION.md §3): the app sends
 * its signed-in user's access token from its own realm (simorgh: Design
 * Suite, hr: the HR chatbot); the token's organization names the company,
 * so a person only ever gets their own company's context. An app's service
 * account in CONTEXT_SERVICE_CLIENTS may name a company (?company=), for its
 * ingestion. The company must have the app.
 */
@Injectable()
export class ContextService {
  private readonly log = new Logger(ContextService.name);
  private readonly realms = config.context.apps.map((a) => ({
    ...a,
    jwks: createRemoteJWKSet(new URL(a.jwksUrl)),
    issuers: [config.context.publicBase, config.context.internalBase].filter(Boolean).map((b) => `${b}/realms/${a.realm}`),
  }));
  private readonly cache = new Map<string, { at: number; value: CompanyContext }>();

  constructor(private readonly db: DbService, private readonly connector: ConnectorClient) {}

  /** Who is asking: the app (by realm) and the company. */
  async resolve(bearer: string, wanted?: string): Promise<{ app: ContextApp; slug: string; caller: string }> {
    let iss: string | undefined;
    try {
      iss = decodeJwt(bearer).iss;
    } catch {
      throw new UnauthorizedException('not a JWT');
    }
    const realm = this.realms.find((r) => r.issuers.includes(iss ?? ''));
    if (!realm) throw new UnauthorizedException(`tokens of ${iss} are not accepted here`);
    let token: AppToken;
    try {
      token = (await jwtVerify(bearer, realm.jwks, { issuer: realm.issuers })).payload as AppToken;
    } catch (e) {
      throw new UnauthorizedException(`invalid token: ${(e as Error).message}`);
    }
    const client = token.client_id ?? token.azp ?? '';
    const service = typeof token.client_id === 'string' || !!token.preferred_username?.startsWith('service-account-');
    if (service) {
      if (!config.context.serviceClients.includes(`${realm.realm}:${client}`)) throw new ForbiddenException(`client ${client} of realm ${realm.realm} may not read company context`);
      if (!wanted) throw new ForbiddenException('a service account names the company: ?company=<slug>');
      return { app: realm.app, slug: wanted, caller: `${realm.realm}:${client}` };
    }
    const pick = chooseOrg(orgsOf(token.organization), wanted);
    if (!pick.slug) throw new ForbiddenException(pick.error);
    return { app: realm.app, slug: pick.slug, caller: `${realm.realm}:${token.sub}` };
  }

  async context(app: ContextApp, slug: string): Promise<CompanyContext> {
    const key = `${app}:${slug}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < config.context.cacheSeconds * 1000) return hit.value;

    const [c] = await this.db.query<{ id: string; slug: string; name: string; status: string; apps: Record<string, boolean> | null; schema: string; odoo: number | null; services: CompanyServices | null }>(
      `SELECT id::text, slug, name, status, apps, schema_name AS schema, odoo_company_id AS odoo, services FROM platform.companies WHERE slug = $1`, [slug]);
    if (!c || c.status !== 'active') throw new NotFoundException(`no active company ${slug}`);
    if (!c.apps?.[app]) throw new ForbiddenException(`${slug} does not use ${app}`);
    if (!SCHEMA_RE.test(c.schema)) throw new Error(`unexpected schema name ${c.schema}`);

    const units = (await this.db.query<{ path: string }>(`
      WITH RECURSIVE t AS (
        SELECT id, name::text AS path FROM "${c.schema}".groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || ' / ' || g.name FROM "${c.schema}".groups g JOIN t ON g.parent_id = t.id
      ) SELECT path FROM t ORDER BY path`)).map((r) => r.path);

    const kinds = kindsFor(app);
    let knowledge: KnowledgeItem[] | undefined;
    let source: CompanyContext['source'] = 'kara';
    // Odoo first when the company is kept there: it also has what was entered in Odoo itself.
    if (c.apps.erp && c.odoo && this.connector.configured) {
      try {
        const page = await this.connector.call<{ items: (KnowledgeItem & { active: boolean })[] }>(
          'GET', `/v1/knowledge?companyId=${c.odoo}&limit=500`);
        knowledge = page.items.filter((k) => k.active !== false).map(pick);
        source = 'odoo';
      } catch (e) {
        this.log.warn(`context ${slug}: Odoo unavailable, Kara's copy instead: ${(e as Error).message}`);
      }
    }
    if (!knowledge) {
      const has = (await this.db.query<{ t: string | null }>(`SELECT to_regclass('"${c.schema}".knowledge')::text AS t`))[0]?.t;
      knowledge = has ? (await this.db.query<KnowledgeItem>(`
        SELECT kind, name, code, summary, body, attributes, address, impact, to_char(effective_date, 'YYYY-MM-DD') AS "effectiveDate"
        FROM "${c.schema}".knowledge WHERE active ORDER BY sequence, name`)).map(pick) : [];
    }

    const value: CompanyContext = {
      company: { slug: c.slug, name: c.name }, app, units,
      // The company's servers: Design Suite's business only.
      services: app === 'designSuite' ? (c.services ?? {}) : {},
      knowledge: knowledge.filter((k) => kinds.includes(k.kind)),
      source, generatedAt: new Date().toISOString(),
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

/** Only the fields the contract names (Odoo's records carry ids and refs too). */
function pick(k: KnowledgeItem): KnowledgeItem {
  return {
    kind: k.kind, name: k.name, code: k.code ?? null, summary: k.summary ?? null, body: k.body ?? null,
    attributes: k.attributes ?? {}, address: k.address ?? null, impact: k.impact ?? null, effectiveDate: k.effectiveDate ?? null,
  };
}
