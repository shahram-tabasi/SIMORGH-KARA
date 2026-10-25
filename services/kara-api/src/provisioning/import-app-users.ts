// The people who already use an app, into Kara: realm simorgh's users
// (Design Suite) become Kara accounts and members of their company, with
// their app roles, so Kara manages them from then on (docs/INTEGRATION.md §6).
//
// Which company: a realm role named after a Kara company's slug (`ekc`),
// else the email domain (--domains electrokavir.com=ekc,simorghai.com=simorgh).
// Only enabled users with a verified email; service accounts never.
// Existing Kara accounts are left as they are (their app roles are added).
// The company gets the app switched on, so the provisioner adopts the
// existing Keycloak account (karaAdopted: never disabled) instead of taking
// its roles away; it also becomes an Odoo employee where the company keeps
// Odoo.

import { randomBytes } from 'crypto';
import type { KcUser } from '../auth/keycloak';
import type { DbService } from '../infra/db.service';
import type { ProvisionerService } from './provisioner.service';
import type { AppKey } from './plan';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;
const BCRYPT = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A well-formed bcrypt hash nothing matches: these people sign in through Keycloak. */
function unusableHash(): string {
  const b = randomBytes(53);
  return '$2a$10$' + [...b].map((x) => BCRYPT[x % 64]).join('');
}

export interface ImportOptions {
  app: AppKey;
  /** email domain → company slug */
  domains: Record<string, string>;
  dryRun: boolean;
}

export async function importAppUsers(db: DbService, provisioner: ProvisionerService, o: ImportOptions): Promise<string[]> {
  const realm = provisioner.realms.find((r) => r.key === o.app);
  if (!realm) throw new Error(`no app realm ${o.app} (its client secret is not set)`);
  const out: string[] = [];
  const companies = await db.query<{ id: string; slug: string; schema: string; apps: Record<string, boolean> | null }>(
    `SELECT id::text, slug, schema_name AS schema, apps FROM platform.companies WHERE status = 'active'`);
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  // Kara role ← realm role (offer ← offer, engineering ← simorgh-engineer).
  const karaRoleOf = new Map(Object.entries(realm.roles).map(([kara, kc]) => [kc, kara]));

  const users: KcUser[] = [];
  for (let first = 0; ; first += 200) {
    const { body } = await realm.admin.request<KcUser[]>('GET', `/users?first=${first}&max=200&briefRepresentation=false`);
    users.push(...body);
    if (body.length < 200) break;
  }

  const counts = { created: 0, existing: 0, skipped: 0 };
  const enabledApp = new Set<string>();
  for (const u of users) {
    const email = (u.email ?? '').toLowerCase();
    if (!email || !u.enabled || !u.emailVerified || u.username.startsWith('service-account-')) { counts.skipped++; continue; }
    const roles = (await realm.admin.userRealmRoles(u.id)).map((r) => r.name);
    const company = roles.map((r) => bySlug.get(r)).find(Boolean) ?? bySlug.get(o.domains[email.split('@')[1]] ?? '');
    if (!company) { out.push(`skip     ${email} — no company (no company role, domain not mapped)`); counts.skipped++; continue; }
    if (!SCHEMA_RE.test(company.schema)) throw new Error(`unexpected schema ${company.schema}`);
    const appRoles = roles.map((r) => karaRoleOf.get(r)).filter((r): r is string => !!r);
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || email.split('@')[0];

    if (o.dryRun) {
      out.push(`would    ${email} → ${company.slug}${appRoles.length ? ` [${appRoles.join(', ')}]` : ''}`);
      continue;
    }

    await db.tx(async (c) => {
      const s = company.schema;
      let [acc] = (await c.query<{ id: string; company_id: string | null }>(
        `SELECT id::text, company_id::text FROM platform.user_accounts WHERE email = $1`, [email])).rows;
      let made = false;
      if (!acc) {
        [acc] = (await c.query<{ id: string; company_id: string | null }>(
          `INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id) VALUES ($1, $2, $3, $4)
           RETURNING id::text, company_id::text`, [email, unusableHash(), fullName, company.id])).rows;
        made = true;
      }
      if (acc.company_id && acc.company_id !== company.id) {
        out.push(`skip     ${email} — already in another Kara company`);
        counts.skipped++;
        return;
      }
      let [m] = (await c.query<{ id: string }>(`SELECT id::text FROM "${s}".members WHERE account_id = $1`, [acc.id])).rows;
      if (!m) {
        [m] = (await c.query<{ id: string }>(`INSERT INTO "${s}".members (account_id, full_name) VALUES ($1, $2) RETURNING id::text`, [acc.id, fullName])).rows;
        await c.query(`INSERT INTO "${s}".kartabls (member_id, name) VALUES ($1, 'کارتابل اصلی')`, [m.id]);
        await c.query(`INSERT INTO "${s}".member_employment (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [m.id]);
      }
      for (const r of appRoles) {
        await c.query(`INSERT INTO "${s}".member_apps (member_id, app, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [m.id, o.app, r]);
      }
      if (appRoles.length && !company.apps?.[o.app] && !enabledApp.has(company.id)) {
        await c.query(`UPDATE platform.companies SET apps = coalesce(apps, '{}'::jsonb) || jsonb_build_object($2::text, true) WHERE id = $1`, [company.id, o.app]);
        await c.query(`INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason) VALUES ('company', $1, $1, 'app users imported')
          ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING`, [company.id]);
        enabledApp.add(company.id);
        out.push(`app      ${company.slug}: ${o.app} switched on`);
      }
      await c.query(`INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason) VALUES ('member', $1, $2, 'imported from the app realm')
        ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING`, [acc.id, company.id]);
      // The company's quota grows with the people it already has.
      await c.query(`UPDATE platform.companies SET max_users = greatest(max_users, (SELECT count(*) FROM platform.user_accounts WHERE company_id = $1)) WHERE id = $1`, [company.id]);
      if (made) counts.created++; else counts.existing++;
      out.push(`${made ? 'created ' : 'existing'} ${email} → ${company.slug}${appRoles.length ? ` [${appRoles.join(', ')}]` : ''}`);
    });
  }
  out.push('', `${counts.created} created, ${counts.existing} already in Kara, ${counts.skipped} skipped${o.dryRun ? ' (dry run: nothing written)' : ''}`);
  return out;
}
