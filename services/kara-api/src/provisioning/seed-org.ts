// A company's prepared organisation, laid onto what it already has in Kara
// (cli.js seed-org <slug> [--dry-run] [--prune] [--place email=Unit/Path…]):
//
//   units      its chart (Kara's groups, Odoo's departments). A unit already
//              there by the same name is kept (and moved under its chart
//              parent), one an earlier layout named differently is renamed
//              or merged into it (`aliases`); only missing ones are made.
//              Units outside the chart are reported, and with --prune
//              removed once nobody and nothing is in them.
//   people     everyone not yet in a unit of the chart goes to `defaultUnit`,
//              the people named in `people` (or with --place) to theirs —
//              their unit memberships replaced. Someone already in a chart
//              unit stays where they are, so a second run moves nobody.
//   owners     the platform's owners: Kara platform administrators, members
//              of the company in their unit with its full role.
//   knowledge  its HR rules (with the original documents) and products: a
//              rule by its document number, updated when a new revision of
//              it comes; a product by its code.
//
// Then the company's job takes it all to Odoo and the apps' realms; a moved
// person's job moves their employee to the new department.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { PoolClient } from 'pg';
import type { DbService } from '../infra/db.service';
import { EKC } from './seed/ekc';
import { unusableHash } from './import-app-users';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;
/** The company's full role (src/lib/rbac.ts DEFAULT_ROLES[0]). */
const FULL_ROLE = 'مدیر سامانه';
const SEED_DIR = join(__dirname, '..', '..', 'seed');

export interface UnitNode { name: string; children: UnitNode[] }
type Path = string[];
interface Product { code: string; name: string; summary: string; body?: string; image?: string; features: Record<string, string | number> }
interface HrRule { code: string; name: string; summary: string; body: string; effectiveDate: string | null; attributes: Record<string, string>; file: string }

export interface OrgSet {
  chart: UnitNode;
  aliases: Record<string, Path>;
  defaultUnit: Path;
  people: { names: string[]; unit: Path }[];
  owners: { email: string; name: string; unit: Path }[];
  hrRules?: string;
  products: Product[];
  /** Product codes an earlier version had: archived. */
  retiredProducts?: string[];
}

const SETS: Record<string, OrgSet> = { ekc: EKC };

/** The companies (slugs) that have a prepared organisation. */
export const orgSets = () => Object.keys(SETS);

/** Names compared as people write them: ZWNJ, spaces, Arabic letter forms, case. */
export const norm = (s: string) => s.toLowerCase().normalize('NFKC')
  .replace(/[‌‏\s._\-()]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');

interface Group { id: string; name: string; parent: string | null }

/** Features compared regardless of key order (jsonb keeps its own). */
const canon = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

export async function seedOrg(db: DbService, slug: string, o: { dryRun: boolean; prune: boolean; place: Record<string, Path> }): Promise<string[]> {
  const set = SETS[slug];
  if (!set) throw new Error(`no organisation set for "${slug}" (known: ${Object.keys(SETS).join(', ')})`);
  const [company] = await db.query<{ id: string; schema: string }>(`SELECT id::text, schema_name AS schema FROM platform.companies WHERE slug = $1`, [slug]);
  if (!company) throw new Error(`no Kara company "${slug}"`);
  if (!SCHEMA_RE.test(company.schema)) throw new Error(`unexpected schema ${company.schema}`);
  const s = company.schema;
  const out: string[] = [];
  const say = (line: string) => out.push(o.dryRun ? `(dry run) ${line}` : line);

  await db.tx(async (c) => {
    const q = async <T>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];
    const moved = new Set<string>(); // account ids whose employee must follow

    // ── Units ───────────────────────────────────────────────────────────────
    const groups = await q<Group>(`SELECT id::text, name, parent_id::text AS parent FROM "${s}".groups`);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const claimed = new Map<string, string>(); // path key → group id
    const used = new Set<string>();
    const key = (p: Path) => p.map(norm).join('/');
    let made = 0;
    let n = 0;
    const fakeId = () => `new-${n++}`;

    const place = async (node: UnitNode, parentPath: Path, parentId: string | null) => {
      const path = [...parentPath, node.name];
      const want = norm(node.name);
      const free = (g: Group) => !used.has(g.id);
      let g = groups.find((x) => free(x) && norm(x.name) === want && x.parent === parentId)
        ?? groups.find((x) => free(x) && norm(x.name) === want)
        ?? groups.find((x) => free(x) && Object.entries(set.aliases).some(([from, to]) => norm(from) === norm(x.name) && key(to) === key(path)));
      if (g) {
        if (g.name !== node.name || g.parent !== parentId) {
          say(`unit     ${path.join(' / ')}  ← «${g.name}»${g.parent !== parentId ? ' moved' : ''}${g.name !== node.name ? ' renamed' : ''}`);
          if (!o.dryRun && !parentId?.startsWith('new-')) await c.query(`UPDATE "${s}".groups SET name = $2, parent_id = $3 WHERE id = $1`, [g.id, node.name, parentId]);
          g = { ...g, name: node.name, parent: parentId };
          byId.set(g.id, g);
        }
      } else {
        made++;
        say(`unit     ${path.join(' / ')}  (new)`);
        const id = o.dryRun || parentId?.startsWith('new-') ? fakeId()
          : (await q<{ id: string }>(`INSERT INTO "${s}".groups (name, parent_id) VALUES ($1, $2) RETURNING id::text`, [node.name, parentId]))[0].id;
        g = { id, name: node.name, parent: parentId };
      }
      used.add(g.id);
      claimed.set(key(path), g.id);
      for (const ch of node.children) await place(ch, path, g.id);
    };
    await place(set.chart, [], null);
    const unitId = (p: Path) => {
      const id = claimed.get(key(p));
      if (!id) throw new Error(`no unit ${p.join(' / ')} in the chart`);
      return id;
    };

    // Units an earlier layout made, a second one for the same chart unit: merged into it.
    const rest = groups.filter((g) => !used.has(g.id));
    for (const g of rest) {
      const to = Object.entries(set.aliases).find(([from]) => norm(from) === norm(g.name))?.[1];
      if (!to) continue;
      const target = unitId(to);
      say(`merge    «${g.name}» → ${to.join(' / ')}`);
      if (!o.dryRun && !target.startsWith('new-')) {
        for (const m of await q<{ account: string }>(`SELECT m.account_id::text AS account FROM "${s}".member_groups mg JOIN "${s}".members m ON m.id = mg.member_id WHERE mg.group_id = $1`, [g.id])) moved.add(m.account);
        await c.query(`INSERT INTO "${s}".member_groups (member_id, group_id) SELECT member_id, $2 FROM "${s}".member_groups WHERE group_id = $1 ON CONFLICT DO NOTHING`, [g.id, target]);
        await c.query(`UPDATE "${s}".groups SET parent_id = $2 WHERE parent_id = $1`, [g.id, target]);
        await c.query(`UPDATE "${s}".knowledge SET unit_id = $2 WHERE unit_id = $1`, [g.id, target]).catch(() => undefined);
        await c.query(`DELETE FROM "${s}".groups WHERE id = $1`, [g.id]);
      }
      used.add(g.id);
    }

    // ── People ──────────────────────────────────────────────────────────────
    const chartIds = new Set(claimed.values());
    const members = await q<{ id: string; account: string; name: string; email: string; units: string[] | null }>(`
      SELECT m.id::text, m.account_id::text AS account, m.full_name AS name, a.email::text AS email,
             array_agg(mg.group_id::text) FILTER (WHERE mg.group_id IS NOT NULL) AS units
      FROM "${s}".members m JOIN platform.user_accounts a ON a.id = m.account_id
      LEFT JOIN "${s}".member_groups mg ON mg.member_id = m.id
      WHERE m.status = 'active' GROUP BY m.id, a.email`);
    const ownerEmails = new Set(set.owners.map((x) => x.email.toLowerCase()));
    const found = new Set<string>();
    for (const m of members) {
      if (ownerEmails.has(m.email.toLowerCase())) continue; // below
      const named = o.place[m.email.toLowerCase()]
        ?? set.people.find((p) => p.names.some((x) => norm(x) === norm(m.name)))?.unit;
      if (named) found.add(norm(m.name));
      const inChart = (m.units ?? []).some((id) => chartIds.has(id));
      const target = named ?? (inChart ? null : set.defaultUnit);
      if (!target) continue;
      const id = unitId(target);
      if ((m.units ?? []).length === 1 && m.units![0] === id) continue;
      say(`person   ${m.name} <${m.email}> → ${target.join(' / ')}`);
      if (!o.dryRun && !id.startsWith('new-')) {
        await c.query(`DELETE FROM "${s}".member_groups WHERE member_id = $1`, [m.id]);
        await c.query(`INSERT INTO "${s}".member_groups (member_id, group_id) VALUES ($1, $2)`, [m.id, id]);
      }
      moved.add(m.account);
    }
    for (const p of set.people) {
      if (!p.names.some((x) => found.has(norm(x)))) say(`NOT FOUND ${p.names[0]} (${p.unit.join(' / ')}): no active member by that name — place them with --place email=${p.unit.join('/')}`);
    }

    // ── Owners ──────────────────────────────────────────────────────────────
    const [role] = await q<{ id: string }>(`SELECT id::text FROM "${s}".roles WHERE name = $1`, [FULL_ROLE]);
    for (const w of set.owners) {
      let [acc] = await q<{ id: string; admin: boolean; company: string | null; name: string }>(
        `SELECT id::text, is_platform_admin AS admin, company_id::text AS company, full_name AS name FROM platform.user_accounts WHERE email = $1`, [w.email]);
      if (!acc) {
        say(`owner    ${w.email}: new account (signs in with Keycloak)`);
        if (o.dryRun) continue;
        [acc] = await q(`INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id, is_platform_admin)
          VALUES ($1, $2, $3, $4, true) RETURNING id::text, is_platform_admin AS admin, company_id::text AS company, full_name AS name`,
          [w.email, unusableHash(), w.name, company.id]);
      }
      if (!acc.admin) {
        say(`owner    ${w.email}: platform administrator`);
        if (!o.dryRun) await c.query(`UPDATE platform.user_accounts SET is_platform_admin = true WHERE id = $1`, [acc.id]);
      }
      if (!acc.company && !o.dryRun) await c.query(`UPDATE platform.user_accounts SET company_id = $2 WHERE id = $1`, [acc.id, company.id]);
      let [m] = await q<{ id: string }>(`SELECT id::text FROM "${s}".members WHERE account_id = $1`, [acc.id]);
      if (!m) {
        say(`owner    ${w.email}: member of ${slug}`);
        if (o.dryRun) continue;
        [m] = await q(`INSERT INTO "${s}".members (account_id, full_name, title) VALUES ($1, $2, 'مالک پلتفرم سیمرغ') RETURNING id::text`, [acc.id, acc.name]);
        await c.query(`INSERT INTO "${s}".kartabls (member_id, name) VALUES ($1, 'کارتابل اصلی')`, [m.id]);
        await c.query(`INSERT INTO "${s}".member_employment (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [m.id]);
      }
      if (role && !o.dryRun) await c.query(`INSERT INTO "${s}".member_roles (member_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [m.id, role.id]);
      const id = unitId(w.unit);
      if (!o.dryRun && !id.startsWith('new-')) {
        const [already] = await q(`SELECT 1 FROM "${s}".member_groups WHERE member_id = $1 AND group_id = $2`, [m.id, id]);
        if (!already) {
          say(`owner    ${w.email} → ${w.unit.join(' / ')}, role ${FULL_ROLE}`);
          await c.query(`DELETE FROM "${s}".member_groups WHERE member_id = $1`, [m.id]);
          await c.query(`INSERT INTO "${s}".member_groups (member_id, group_id) VALUES ($1, $2)`, [m.id, id]);
          moved.add(acc.id);
        }
      }
    }

    // ── Units outside the chart ─────────────────────────────────────────────
    const outside = (await q<Group & { people: number; kids: number }>(`
      SELECT g.id::text, g.name, g.parent_id::text AS parent,
             (SELECT count(*)::int FROM "${s}".member_groups mg WHERE mg.group_id = g.id) AS people,
             (SELECT count(*)::int FROM "${s}".groups k WHERE k.parent_id = g.id) AS kids
      FROM "${s}".groups g`)).filter((g) => !used.has(g.id) && !chartIds.has(g.id));
    for (const g of outside) {
      if (o.prune && !g.people && !g.kids) {
        say(`remove   «${g.name}» (outside the chart, empty)`);
        if (!o.dryRun) await c.query(`DELETE FROM "${s}".groups WHERE id = $1`, [g.id]);
      } else {
        say(`outside  «${g.name}» (${g.people} people, ${g.kids} units) — kept${o.prune ? ' (not empty)' : '; --prune removes it once empty'}`);
      }
    }

    // ── Knowledge ───────────────────────────────────────────────────────────
    const hasKnowledge = (await q<{ t: string | null }>(`SELECT to_regclass('"${s}".knowledge')::text AS t`))[0]?.t;
    if (!hasKnowledge) {
      say('knowledge: no table yet (run the Kara migration first)');
    } else {
      const rules: HrRule[] = set.hrRules ? JSON.parse(readFileSync(join(SEED_DIR, set.hrRules), 'utf8')) : [];
      for (const [i, r] of rules.entries()) {
        const doc = r.code.replace(/-\d+$/, ''); // EKWI-AD-001-08 → EKWI-AD-001
        const [have] = await q<{ id: string; code: string | null }>(`SELECT id::text, code FROM "${s}".knowledge WHERE kind = 'hr_rule' AND (code = $1 OR code LIKE $2) ORDER BY code DESC LIMIT 1`, [r.code, `${doc}-%`]);
        if (have?.code === r.code) continue;
        say(`rule     ${r.code} ${r.name}${have ? ` (replaces ${have.code})` : ''}`);
        if (o.dryRun) continue;
        const file = readFileSync(join(SEED_DIR, dirname(set.hrRules!), r.file));
        const vals = [r.name, r.code, r.summary, r.body, JSON.stringify(r.attributes), r.effectiveDate, (i + 1) * 10,
          r.file.split('/').pop(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file.length, file];
        if (have) {
          await c.query(`UPDATE "${s}".knowledge SET name = $2, code = $3, summary = $4, body = $5, attributes = $6, effective_date = $7, sequence = $8,
            file_name = $9, file_mime = $10, file_size = $11, file_data = $12, active = true, updated_at = now() WHERE id = $1`, [have.id, ...vals]);
        } else {
          await c.query(`INSERT INTO "${s}".knowledge (kind, name, code, summary, body, attributes, effective_date, sequence, file_name, file_mime, file_size, file_data)
            VALUES ('hr_rule', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, vals);
        }
      }
      for (const [i, p] of set.products.entries()) {
        const image = p.image ? readFileSync(join(SEED_DIR, p.image)) : null;
        const mime = p.image ? (p.image.endsWith('.png') ? 'image/png' : 'image/jpeg') : null;
        const want = { name: p.name, summary: p.summary, body: p.body ?? null, attributes: p.features, sequence: (i + 1) * 10 };
        const [have] = await q<{ id: string; name: string; summary: string | null; body: string | null; attributes: Record<string, unknown>; active: boolean; sequence: number; image: Buffer | null }>(
          `SELECT id::text, name, summary, body, attributes, active, sequence, image_data AS image FROM "${s}".knowledge WHERE kind = 'product' AND code = $1`, [p.code]);
        if (!have) {
          say(`product  ${p.code} ${p.name}`);
          if (!o.dryRun) {
            await c.query(`INSERT INTO "${s}".knowledge (kind, name, code, summary, body, attributes, sequence, image_mime, image_data) VALUES ('product', $1, $2, $3, $4, $5, $6, $7, $8)`,
              [p.name, p.code, p.summary, want.body, JSON.stringify(p.features), want.sequence, mime, image]);
          }
          continue;
        }
        const same = have.name === want.name && have.summary === want.summary && (have.body ?? null) === want.body && have.active && have.sequence === want.sequence
          && canon(have.attributes ?? {}) === canon(want.attributes) && (!image || (have.image && image.equals(have.image)));
        if (same) continue;
        say(`product  ${p.code} ${p.name} (updated)`);
        if (!o.dryRun) {
          await c.query(`UPDATE "${s}".knowledge SET name = $2, summary = $3, body = $4, attributes = $5, active = true, updated_at = now(),
              image_mime = COALESCE($6, image_mime), image_data = COALESCE($7, image_data), sequence = $8 WHERE id = $1`,
            [have.id, p.name, p.summary, want.body, JSON.stringify(p.features), mime, image, want.sequence]);
        }
      }
      for (const code of set.retiredProducts ?? []) {
        const [old] = await q<{ id: string; name: string }>(`SELECT id::text, name FROM "${s}".knowledge WHERE kind = 'product' AND code = $1 AND active`, [code]);
        if (!old) continue;
        say(`product  ${code} ${old.name} archived (replaced)`);
        if (!o.dryRun) await c.query(`UPDATE "${s}".knowledge SET active = false, updated_at = now() WHERE id = $1`, [old.id]);
      }
    }

    // ── To Odoo and the apps' realms ────────────────────────────────────────
    if (!o.dryRun) {
      await c.query(`INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason) VALUES ('company', $1, $1, 'organisation seeded')
        ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING`, [company.id]);
      for (const account of moved) await enqueueMember(c, account, company.id);
    }
    out.push('', `${made} unit(s) to make, ${moved.size} person(s) placed${o.dryRun ? ' — dry run: nothing written' : ''}`);
  });
  return out;
}

async function enqueueMember(c: PoolClient, account: string, companyId: string) {
  await c.query(`INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason) VALUES ('member', $1, $2, 'placed in the organisation chart')
    ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING`, [account, companyId]);
}
