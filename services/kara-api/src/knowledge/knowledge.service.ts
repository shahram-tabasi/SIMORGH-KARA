import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { extractText, READABLE } from './extract';
import { unitForPath, visible } from './visibility';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;
const nc = () => config.team.nextcloud;

interface DavEntry { href: string; isDir: boolean; etag: string | null; fileId: string | null; mime: string | null; size: number; modified: string | null }

/** A WebDAV PROPFIND (Depth 1) multistatus → entries. Regex, not a parser: Nextcloud's replies are regular. Exported for tests. */
export function parseMultistatus(xml: string): DavEntry[] {
  const out: DavEntry[] = [];
  for (const r of xml.match(/<d:response>[\s\S]*?<\/d:response>/g) ?? []) {
    const tag = (t: string) => r.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? null;
    const href = tag('d:href');
    if (!href) continue;
    out.push({
      href: decodeURIComponent(href),
      isDir: /<d:collection\s*\/>/.test(r),
      etag: tag('d:getetag')?.replace(/&quot;|"/g, '') ?? null,
      fileId: tag('oc:fileid'),
      mime: tag('d:getcontenttype'),
      size: Number(tag('d:getcontentlength') ?? tag('oc:size') ?? 0),
      modified: tag('d:getlastmodified'),
    });
  }
  return out;
}

export interface Citation { title: string; url: string | null; source: 'kara' | 'nextcloud'; excerpt: string }

/**
 * Phase 6 (docs/TEAM-PLATFORM.md): what the assistant may quote, filtered by
 * what the person may open. Two sources, one rule (visibility.ts):
 *  - Kara's own knowledge (rules, orders, products; uploaded PDF/Word text),
 *    by company and unit as on Kara's knowledge page;
 *  - Nextcloud documents under /Kara/<company>/…, folders named like Kara's
 *    units; copied as text into kara_team.documents every NEXTCLOUD_SYNC_HOURS.
 * The search runs in PostgreSQL, filtered by company and unit before
 * anything is returned: nothing a person may not open reaches the model.
 */
@Injectable()
export class KnowledgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(KnowledgeService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DbService) {}

  get nextcloudOn() { return !!(nc().url && nc().appPassword); }

  onApplicationBootstrap() {
    if (process.env.KARA_API_CLI || !this.nextcloudOn) return;
    const run = () => this.syncAll().catch((e) => this.log.error(`nextcloud sync: ${(e as Error).message}`));
    setTimeout(run, 30_000);
    if (nc().syncHours > 0) this.timer = setInterval(run, nc().syncHours * 3600_000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ── Nextcloud → kara_team.documents ──────────────────────────────────────

  private auth() { return `Basic ${Buffer.from(`${nc().user}:${nc().appPassword}`).toString('base64')}`; }
  private davBase() { return `${nc().url}/remote.php/dav/files/${encodeURIComponent(nc().user)}`; }
  private enc(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }

  private async propfind(path: string): Promise<DavEntry[]> {
    const res = await fetch(`${this.davBase()}/${this.enc(path)}`, {
      method: 'PROPFIND',
      headers: { Authorization: this.auth(), Depth: '1', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>
        <d:resourcetype/><d:getetag/><oc:fileid/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return [];
    if (res.status !== 207) throw new Error(`PROPFIND ${path}: HTTP ${res.status}`);
    return parseMultistatus(await res.text());
  }

  async syncAll() {
    const companies = await this.db.query<{ id: string; slug: string; schema: string }>(
      `SELECT id::text, slug, schema_name AS schema FROM platform.companies WHERE status = 'active'`);
    for (const c of companies) {
      if (!SCHEMA_RE.test(c.schema)) continue;
      try { await this.syncCompany(c); } catch (e) { this.log.warn(`nextcloud ${c.slug}: ${(e as Error).message}`); }
    }
  }

  private async unitPaths(schema: string): Promise<string[][]> {
    return (await this.db.query<{ path: string[] }>(`
      WITH RECURSIVE t AS (
        SELECT id, ARRAY[name] AS path FROM "${schema}".groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || g.name FROM "${schema}".groups g JOIN t ON g.parent_id = t.id
      ) SELECT path FROM t`)).map((r) => r.path);
  }

  async syncCompany(c: { id: string; slug: string; schema: string }) {
    const root = `${nc().root}/${c.slug}`;
    const units = await this.unitPaths(c.schema);
    const prefix = decodeURIComponent(new URL(`${this.davBase()}/${this.enc(root)}/`).pathname);
    const seen: string[] = [];
    let indexed = 0; let skipped = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > 8) return;
      for (const e of await this.propfind(dir)) {
        const rel = e.href.startsWith(prefix) ? e.href.slice(prefix.length).replace(/\/$/, '') : null;
        if (rel === null || rel === '' || `${root}/${rel}` === dir) continue;
        if (e.isDir) { await walk(`${root}/${rel}`, depth + 1); continue; }
        const unit = unitForPath(rel, units);
        const ext = rel.toLowerCase().split('.').pop() ?? '';
        if (unit === null || !READABLE.has(ext) || e.size > nc().maxBytes) { skipped += 1; continue; }
        seen.push(rel);
        const [have] = await this.db.query<{ etag: string | null; unit: string[] }>(
          `SELECT etag, unit_path AS unit FROM kara_team.documents WHERE company_id = $1 AND path = $2`, [c.id, rel]);
        if (have && have.etag === e.etag && JSON.stringify(have.unit) === JSON.stringify(unit)) continue;
        const res = await fetch(`${this.davBase()}/${this.enc(`${root}/${rel}`)}`, { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) { skipped += 1; continue; }
        let body = '';
        try { body = extractText(rel, Buffer.from(await res.arrayBuffer())) ?? ''; } catch (err) { this.log.warn(`${rel}: ${(err as Error).message}`); }
        await this.db.query(`
          INSERT INTO kara_team.documents (company_id, path, file_id, unit_path, title, etag, mime, size, body, modified_at, synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
          ON CONFLICT (company_id, path) DO UPDATE SET file_id = $3, unit_path = $4, title = $5, etag = $6, mime = $7, size = $8,
            body = $9, modified_at = $10, synced_at = now()`,
        [c.id, rel, e.fileId, unit, rel.split('/').pop()!, e.etag, e.mime, e.size, body.slice(0, 500_000), e.modified ? new Date(e.modified) : null]);
        indexed += 1;
      }
    };
    await walk(root, 0);
    // Gone from Nextcloud, or moved where it no longer belongs: out of the index.
    const removed = await this.db.query(`DELETE FROM kara_team.documents WHERE company_id = $1 AND NOT (path = ANY($2)) RETURNING 1`, [c.id, seen]);
    this.log.log(`nextcloud ${c.slug}: ${indexed} indexed, ${seen.length} kept, ${skipped} skipped, ${removed.length} removed`);
  }

  // ── Search, as the person ────────────────────────────────────────────────

  /** The person's company and units (paths of names). Null: no active membership. */
  async scope(accountId: string): Promise<{ companyId: string; slug: string; schema: string; units: string[][] } | null> {
    const [a] = await this.db.query<{ company_id: string; slug: string; schema: string }>(`
      SELECT a.company_id::text, c.slug, c.schema_name AS schema FROM platform.user_accounts a JOIN platform.companies c ON c.id = a.company_id
      WHERE a.id = $1 AND a.status = 'active' AND c.status = 'active'`, [accountId]);
    if (!a || !SCHEMA_RE.test(a.schema)) return null;
    const [m] = await this.db.query<{ id: string }>(`SELECT id::text FROM "${a.schema}".members WHERE account_id = $1 AND status = 'active'`, [accountId]);
    if (!m) return null;
    const all = await this.db.query<{ id: string; path: string[] }>(`
      WITH RECURSIVE t AS (
        SELECT id, ARRAY[name] AS path FROM "${a.schema}".groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || g.name FROM "${a.schema}".groups g JOIN t ON g.parent_id = t.id
      ) SELECT t.id::text, t.path FROM t JOIN "${a.schema}".member_groups mg ON mg.group_id = t.id WHERE mg.member_id = $1`, [m.id]);
    return { companyId: a.company_id, slug: a.slug, schema: a.schema, units: all.map((r) => r.path) };
  }

  async search(accountId: string, query: string): Promise<{ results: Citation[]; error?: string }> {
    const q = query.trim().slice(0, 200);
    if (!q) return { results: [] };
    const s = await this.scope(accountId);
    if (!s) return { results: [], error: 'عضویت فعالی در شرکتی ندارید.' };
    const kara = `https://${new URL(config.team.sso.publicBase).host}/app/${encodeURIComponent(s.slug)}/knowledge`;
    // Kara's knowledge: each item's unit as a path, then the same rule.
    const items = await this.db.query<{ name: string; kind: string; excerpt: string; unit: string[] | null }>(`
      WITH RECURSIVE t AS (
        SELECT id, ARRAY[name] AS path FROM "${s.schema}".groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || g.name FROM "${s.schema}".groups g JOIN t ON g.parent_id = t.id
      )
      SELECT k.name, k.kind, left(coalesce(k.summary, '') || ' ' || coalesce(k.body, ''), 1200) AS excerpt, t.path AS unit
      FROM "${s.schema}".knowledge k LEFT JOIN t ON t.id = k.unit_id
      WHERE k.active AND (to_tsvector('simple', k.name || ' ' || coalesce(k.summary, '') || ' ' || coalesce(k.body, '')) @@ plainto_tsquery('simple', $1)
                          OR k.name ILIKE '%' || $1 || '%' OR k.body ILIKE '%' || $1 || '%')
      ORDER BY ts_rank(to_tsvector('simple', k.name || ' ' || coalesce(k.body, '')), plainto_tsquery('simple', $1)) DESC LIMIT 30`, [q]);
    const docs = await this.db.query<{ title: string; path: string; file_id: string | null; unit: string[]; excerpt: string }>(`
      SELECT title, path, file_id, unit_path AS unit,
             ts_headline('simple', body, plainto_tsquery('simple', $2), 'MaxFragments=2, MaxWords=40, MinWords=15') AS excerpt
      FROM kara_team.documents WHERE company_id = $1 AND (tsv @@ plainto_tsquery('simple', $2) OR title ILIKE '%' || $2 || '%')
      ORDER BY ts_rank(tsv, plainto_tsquery('simple', $2)) DESC LIMIT 30`, [s.companyId, q]);
    const results: Citation[] = [
      ...items.filter((i) => visible(i.unit ?? [], s.units)).slice(0, 6)
        .map((i) => ({ title: `${i.name} (${i.kind})`, url: kara, source: 'kara' as const, excerpt: i.excerpt })),
      ...docs.filter((d) => visible(d.unit, s.units)).slice(0, 6)
        .map((d) => ({ title: d.title, url: d.file_id ? `${nc().publicUrl}/f/${d.file_id}` : null, source: 'nextcloud' as const, excerpt: d.excerpt })),
    ];
    return { results };
  }
}
