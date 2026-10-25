import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { KcUser, KeycloakAdmin } from '../auth/keycloak';
import { config } from '../config';
import { ConnectorClient } from '../erp/connector.client';
import { DbService } from '../infra/db.service';
import { splitName } from '../identity/identity.service';
import { OdooCompany, OdooMember, OdooSync, Outcome } from './odoo';
import {
  AppKey, AppMapping, CompanyFacts, MemberFacts, UnitFacts, companyGroupPaths, companyRoot, companyUses, companyUsesOdoo, diff,
  managedRoles, planMember,
} from './plan';

interface Job { id: string; entity: 'company' | 'member'; entity_id: string; company_id: string | null; attempts: number }

interface AppRealm extends AppMapping {
  target: string;
  admin: KeycloakAdmin;
}

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

/**
 * Carries Kara's companies, units, people and app access into each app's
 * Keycloak realm (docs/INTEGRATION.md): kara-web writes a job in the same
 * transaction as the change (platform.provisioning_jobs), this runs it.
 *
 * Every step looks first and changes only the difference, so a job can run
 * twice (a retry, two pods) without harm. A failed job waits longer each
 * time and gives up after PROVISION_MAX_ATTEMPTS; what each realm holds is
 * written to platform.provisioning_state for Kara's screens.
 *
 * Kara changes only what it manages: the roles it maps, the company's own
 * role, the groups under /companies/<slug>, and accounts it made (attribute
 * karaId). An account with the same email that Kara did not make is never
 * disabled or stripped.
 */
@Injectable()
export class ProvisionerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ProvisionerService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private busy = false;
  readonly realms: AppRealm[] = config.provision.apps
    .filter((a) => a.clientSecret)
    .map((a) => ({
      key: a.key, target: a.target, roles: a.roles,
      admin: new KeycloakAdmin({
        realmUrl: a.realmUrl, clientId: a.clientId, clientSecret: a.clientSecret,
        invite: { clientId: a.inviteClientId, redirectUri: a.inviteRedirectUri, lifespanSeconds: config.keycloak.inviteLifespanSeconds },
      }),
    }));

  private readonly odoo: OdooSync;

  constructor(private readonly db: DbService, connector: ConnectorClient) {
    this.odoo = new OdooSync(connector, async (companyId, odooCompanyId) => {
      await this.db.query('UPDATE platform.companies SET odoo_company_id = $2 WHERE id = $1 AND odoo_company_id IS NULL', [companyId, odooCompanyId]);
    });
  }

  onModuleInit() {
    if (!config.provision.enabled) {
      this.log.log('provisioning off (PROVISION_ENABLED=false)');
      return;
    }
    const targets = [...this.realms.map((r) => r.target), ...(this.odoo.configured ? ['odoo'] : [])];
    this.log.log(`provisioning into ${targets.join(', ') || 'nothing (no client secrets, no erp-connector)'}`);
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private reconcileCheckedAt = 0;

  /**
   * Reconciliation: once every PROVISION_RECONCILE_HOURS, every company and
   * person is queued again, so whatever drifted (an edit by hand in Keycloak
   * or Odoo, a lost job, a change Kara has no event for) is put back. Looked
   * at every 10 minutes; the database says when it last ran, so several pods
   * and restarts do not multiply it, and a job already waiting is joined.
   */
  private async reconcileIfDue() {
    if (!config.provision.reconcileHours || Date.now() - this.reconcileCheckedAt < 10 * 60_000) return;
    this.reconcileCheckedAt = Date.now();
    const rows = await this.db.query<{ n: string }>(`
      WITH due AS (
        SELECT NOT EXISTS (SELECT 1 FROM platform.provisioning_jobs
          WHERE reason = 'reconcile' AND created_at > now() - make_interval(hours => $1)) AS yes
      ), ins AS (
        INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason)
        SELECT 'company', c.id, c.id, 'reconcile' FROM platform.companies c, due WHERE due.yes
        UNION ALL
        SELECT 'member', a.id, a.company_id, 'reconcile' FROM platform.user_accounts a, due WHERE due.yes AND a.company_id IS NOT NULL
        ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING
        RETURNING 1
      ) SELECT count(*)::text AS n FROM ins`, [config.provision.reconcileHours]);
    const n = Number(rows[0]?.n ?? 0);
    if (n) this.log.log(`reconciliation: ${n} companies and people queued`);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule()), config.provision.pollMs);
  }

  /** Claim due jobs (SKIP LOCKED: several pods share the queue) and run them. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      if (!(await this.ready())) return 0;
      await this.reconcileIfDue();
      // A job left running by a pod that went away. People's own changes go before reconciliation's.
      await this.db.query(`UPDATE platform.provisioning_jobs SET status = 'pending', next_at = now()
        WHERE status = 'running' AND started_at < now() - interval '10 minutes'`);
      const jobs = await this.db.query<Job>(`
        UPDATE platform.provisioning_jobs SET status = 'running', started_at = now(), attempts = attempts + 1
        WHERE id IN (SELECT id FROM platform.provisioning_jobs WHERE status = 'pending' AND next_at <= now()
                     ORDER BY (reason = 'reconcile'), id LIMIT 10 FOR UPDATE SKIP LOCKED)
        RETURNING id::text, entity, entity_id::text, company_id::text, attempts`);
      for (const j of jobs) await this.run(j);
      return jobs.length;
    } catch (e) {
      this.log.error(`provisioning tick: ${(e as Error).message}`);
      return 0;
    } finally {
      this.busy = false;
    }
  }

  /** The tables come with kara-web's migration; until then there is nothing to do. */
  private async ready(): Promise<boolean> {
    const [r] = await this.db.query<{ t: string | null }>(`SELECT to_regclass('platform.provisioning_jobs')::text AS t`);
    return !!r?.t;
  }

  private async run(j: Job) {
    try {
      if (j.entity === 'company') await this.company(j.entity_id);
      else await this.member(j.entity_id, j.company_id);
      await this.db.query(`UPDATE platform.provisioning_jobs SET status = 'done', done_at = now(), last_error = NULL WHERE id = $1`, [j.id]);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 1000);
      const giveUp = j.attempts >= config.provision.maxAttempts;
      // 20 s, 40 s, 80 s … at most an hour between attempts.
      const wait = Math.min(3600, 20 * 2 ** (j.attempts - 1));
      this.log.warn(`job ${j.id} (${j.entity} ${j.entity_id}) attempt ${j.attempts}: ${msg}`);
      // A newer job for the same thing may wait already (the unique index allows one pending): then this one ends.
      await this.db.query(`
        UPDATE platform.provisioning_jobs SET
          status = CASE WHEN $2 OR EXISTS (SELECT 1 FROM platform.provisioning_jobs o
                     WHERE o.entity = $4 AND o.entity_id = $5::uuid AND o.status = 'pending' AND o.id <> $1)
                   THEN 'failed' ELSE 'pending' END,
          last_error = $3, next_at = now() + make_interval(secs => $6)
        WHERE id = $1`, [j.id, giveUp, msg, j.entity, j.entity_id, wait]);
    }
  }

  // ── Reading Kara ─────────────────────────────────────────────────────────

  private async companyFacts(companyId: string): Promise<(OdooCompany & { schema: string; unitPaths: Map<string, string[]> }) | null> {
    const [c] = await this.db.query<{ id: string; slug: string; name: string; status: string; apps: CompanyFacts['apps'] | null; schema: string; odoo: number | null }>(
      `SELECT id::text, slug, name, status, apps, schema_name AS schema, odoo_company_id AS odoo FROM platform.companies WHERE id = $1`, [companyId]);
    if (!c) return null;
    if (!SCHEMA_RE.test(c.schema)) throw new Error(`unexpected schema name ${c.schema}`);
    const rows = await this.db.query<{ id: string; name: string; parent_id: string | null; manager: string | null; path: string[] }>(`
      WITH RECURSIVE t AS (
        SELECT id, name, parent_id, manager_id, ARRAY[name] AS path FROM "${c.schema}".groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, g.name, g.parent_id, g.manager_id, t.path || g.name FROM "${c.schema}".groups g JOIN t ON g.parent_id = t.id
      ) SELECT t.id::text, t.name, t.parent_id::text, m.account_id::text AS manager, t.path
        FROM t LEFT JOIN "${c.schema}".members m ON m.id = t.manager_id`);
    const unitPaths = new Map(rows.map((r) => [r.id, r.path]));
    const unitList: UnitFacts[] = rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, managerAccountId: r.manager, path: r.path }));
    return {
      id: c.id, slug: c.slug, name: c.name, status: c.status, schema: c.schema, apps: c.apps ?? {},
      units: rows.map((r) => r.path), unitPaths, unitList, odooCompanyId: c.odoo,
    };
  }

  private async memberFacts(accountId: string, company: NonNullable<Awaited<ReturnType<ProvisionerService['companyFacts']>>>): Promise<(MemberFacts & { title: string | null; unitIds: string[] }) | null> {
    const [a] = await this.db.query<{ email: string; full_name: string; status: string }>(
      `SELECT email::text, full_name, status FROM platform.user_accounts WHERE id = $1`, [accountId]);
    if (!a) return null;
    const s = company.schema;
    const [m] = await this.db.query<{ id: string; status: string; title: string | null }>(`SELECT id::text, status, title FROM "${s}".members WHERE account_id = $1`, [accountId]);
    const apps: MemberFacts['apps'] = {};
    const units: string[][] = [];
    const unitIds: string[] = [];
    if (m) {
      const hasApps = (await this.db.query<{ t: string | null }>(`SELECT to_regclass('"${s}".member_apps')::text AS t`))[0]?.t;
      if (hasApps) {
        for (const r of await this.db.query<{ app: AppKey; role: string }>(`SELECT app, role FROM "${s}".member_apps WHERE member_id = $1`, [m.id])) {
          (apps[r.app] ??= []).push(r.role);
        }
      }
      for (const g of await this.db.query<{ group_id: string }>(`SELECT group_id::text FROM "${s}".member_groups WHERE member_id = $1`, [m.id])) {
        const p = company.unitPaths.get(g.group_id);
        if (p) { units.push(p); unitIds.push(g.group_id); }
      }
    }
    return {
      accountId, email: a.email, fullName: a.full_name, accountActive: a.status === 'active',
      memberActive: !!m && m.status === 'active', units, apps, title: m?.title ?? null, unitIds,
    };
  }

  private async state(entity: string, id: string, target: string, status: 'ok' | 'absent' | 'failed', externalId: string | null, detail: string) {
    await this.db.query(`
      INSERT INTO platform.provisioning_state (entity, entity_id, target, status, external_id, detail, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (entity, entity_id, target) DO UPDATE SET status = $4, external_id = $5, detail = $6, synced_at = now()`,
    [entity, id, target, status, externalId, detail.slice(0, 500)]);
  }

  /** Runs each realm's step; the job fails (and is retried) when any realm failed, after all were tried. */
  private async eachRealm(entity: string, id: string, step: (r: AppRealm) => Promise<{ status: 'ok' | 'absent'; externalId: string | null; detail: string }>) {
    const errors: string[] = [];
    for (const r of this.realms) {
      try {
        const out = await step(r);
        await this.state(entity, id, r.target, out.status, out.externalId, out.detail);
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(`${r.target}: ${msg}`);
        await this.state(entity, id, r.target, 'failed', null, msg);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }

  /**
   * Odoo, after the realms: only for a company that keeps its units and
   * people there (app `erp`). Otherwise an old status is dropped, so Kara
   * does not show a copy that is no longer kept.
   */
  private async odooStep(entity: string, id: string, c: CompanyFacts | null, step: () => Promise<Outcome>) {
    if (!this.odoo.configured || !c || !companyUsesOdoo(c)) {
      await this.db.query(`DELETE FROM platform.provisioning_state WHERE entity = $1 AND entity_id = $2 AND target = 'odoo'`, [entity, id]);
      return;
    }
    try {
      const out = await step();
      await this.state(entity, id, 'odoo', out.status, out.externalId, out.detail);
    } catch (e) {
      const msg = (e as Error).message;
      await this.state(entity, id, 'odoo', 'failed', null, msg);
      throw new Error(`odoo: ${msg}`);
    }
  }

  // ── A company: its organization and its unit groups in each app realm ────

  async company(companyId: string) {
    const c = await this.companyFacts(companyId);
    if (!c) return; // deleted: its people's jobs take their accounts away
    await this.both(
      () => this.realmsOfCompany(c),
      () => this.odooStep('company', companyId, c, () => this.odoo.company(c)),
    );
  }

  /** Runs both, then fails if either failed: Keycloak's trouble never holds up Odoo, nor the reverse. */
  private async both(...steps: (() => Promise<void>)[]) {
    const errors: string[] = [];
    for (const step of steps) {
      try { await step(); } catch (e) { errors.push((e as Error).message); }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }

  private async realmsOfCompany(c: NonNullable<Awaited<ReturnType<ProvisionerService['companyFacts']>>>) {
    const companyId = c.id;
    await this.eachRealm('company', companyId, async (r) => {
      if (!companyUses(c, r.key)) return { status: 'absent', externalId: null, detail: c.status !== 'active' ? 'company suspended' : 'app not enabled' };
      const org = await r.admin.ensureOrganization(c.slug, c.name);
      const want = companyGroupPaths(c);
      for (const p of want) await r.admin.ensureGroupPath(p);
      // Units deleted or renamed in Kara: their old groups go (members leave them with it).
      const root = await r.admin.groupByPath(companyRoot(c.slug));
      let removed = 0;
      const walk = async (gid: string) => {
        for (const g of await r.admin.childGroups(gid)) {
          if (!want.includes(g.path)) { await r.admin.deleteGroup(g.id); removed += 1; } else await walk(g.id);
        }
      };
      if (root) await walk(root.id);
      return { status: 'ok', externalId: org.id, detail: `organization ${c.slug}, ${want.length - 1} unit group(s)${removed ? `, ${removed} removed` : ''}` };
    });
  }

  // ── A person: account, organization, units and roles in each app realm ───

  private async findUser(admin: KeycloakAdmin, accountId: string, email: string | null): Promise<KcUser | undefined> {
    const { body } = await admin.request<KcUser[]>('GET', `/users?q=${encodeURIComponent(`karaId:${accountId}`)}&exact=true&briefRepresentation=false`);
    const byId = body.find((u) => u.attributes?.karaId?.includes(accountId));
    if (byId) return byId;
    return email ? admin.userByEmail(email) : undefined;
  }

  private static managedBy(u: KcUser, accountId: string) {
    return !!u.attributes?.karaId?.includes(accountId);
  }

  /** Kara found this account already there: it takes access away from it but never disables it. */
  private static adopted(u: KcUser) {
    return u.attributes?.karaAdopted?.includes('true') ?? false;
  }

  async member(accountId: string, companyId: string | null) {
    const [acc] = await this.db.query<{ company_id: string | null; email: string }>(
      `SELECT company_id::text, email::text FROM platform.user_accounts WHERE id = $1`, [accountId]);
    const cid = acc?.company_id ?? companyId;
    const c = cid ? await this.companyFacts(cid) : null;
    const m = c ? await this.memberFacts(accountId, c) : null;
    const realms = () => this.eachRealm('member', accountId, async (r) => {
      const companyRole = c ? await r.admin.realmRole(c.slug) : undefined;
      const plan = c && m ? planMember(c, m, r, !!companyRole) : { present: false, roles: [], groups: [] };
      const existing = await this.findUser(r.admin, accountId, m?.email ?? acc?.email ?? null);
      if (!plan.present) return this.leave(r, existing, accountId, c?.slug ?? null, !!companyRole);
      return this.join(r, existing, c!, m!, plan, !!companyRole);
    });
    const odoo = () => this.odooStep('member', accountId, c, () => {
      const om: OdooMember | null = m && {
        accountId, email: m.email, fullName: m.fullName, title: m.title, active: m.accountActive && m.memberActive,
        units: c!.unitList.filter((u) => m.unitIds.includes(u.id)),
      };
      return this.odoo.member(c!, om, accountId);
    });
    await this.both(realms, odoo);
  }

  private async join(r: AppRealm, existing: KcUser | undefined, c: CompanyFacts, m: MemberFacts, plan: ReturnType<typeof planMember>, companyRoleExists: boolean) {
    const names = splitName(m.fullName);
    let user = existing;
    let invited = '';
    if (!user) {
      const id = await r.admin.createUser({
        username: m.email, email: m.email, ...names, enabled: true, emailVerified: false,
        attributes: { karaId: [m.accountId] },
      });
      user = { id, username: m.email, email: m.email, enabled: true };
      try {
        await r.admin.invite(id);
        invited = ', invited';
      } catch (e) {
        invited = `, invitation not sent (${(e as Error).message})`;
      }
    } else if (!ProvisionerService.managedBy(user, m.accountId)) {
      // An account with the same email that Kara did not make (a staff account
      // in realm simorgh): Kara manages its roles and groups from now on, but
      // never its name or whether it is enabled.
      const attributes = { ...(user.attributes ?? {}), karaId: [m.accountId], karaAdopted: ['true'] };
      await r.admin.updateUser(user.id, { ...user, attributes });
    } else if (!ProvisionerService.adopted(user)) {
      await r.admin.updateUser(user.id, { ...user, ...names, enabled: true });
    }
    const org = await r.admin.ensureOrganization(c.slug, c.name);
    await r.admin.addMember(org.id, user.id);

    // Units: groups under the company's root.
    const root = companyRoot(c.slug);
    const inCompany = (p: string) => p === root || p.startsWith(`${root}/`);
    const have = await r.admin.userGroups(user.id);
    const g = diff(plan.groups, have.map((x) => x.path), inCompany);
    for (const p of g.add) await r.admin.joinGroup(user.id, (await r.admin.ensureGroupPath(p)).id);
    for (const p of g.remove) {
      const grp = have.find((x) => x.path === p);
      if (grp) await r.admin.leaveGroup(user.id, grp.id);
    }

    // Roles: only those Kara manages in this realm.
    const managed = managedRoles(r, c.slug, companyRoleExists);
    const current = await r.admin.userRealmRoles(user.id);
    const rd = diff(plan.roles, current.map((x) => x.name), (n) => managed.has(n));
    const missing: string[] = [];
    const toAdd = [];
    for (const n of rd.add) {
      const role = await r.admin.realmRole(n);
      if (role) toAdd.push(role); else missing.push(n);
    }
    await r.admin.addRealmRoles(user.id, toAdd);
    await r.admin.removeRealmRoles(user.id, current.filter((x) => rd.remove.includes(x.name)));
    if (missing.length) throw new Error(`realm role(s) ${missing.join(', ')} do not exist in this realm (deploy/keycloak/setup-realm.sh app-realms)`);
    return {
      status: 'ok' as const, externalId: user.id,
      detail: `roles ${plan.roles.join(', ')}; ${plan.groups.length} unit(s)${existing ? '' : ', created'}${invited}`,
    };
  }

  private async leave(r: AppRealm, user: KcUser | undefined, accountId: string, slug: string | null, companyRoleExists: boolean) {
    if (!user) return { status: 'absent' as const, externalId: null, detail: 'no access to this app' };
    if (!ProvisionerService.managedBy(user, accountId)) {
      return { status: 'absent' as const, externalId: user.id, detail: 'an account with this email exists there that Kara did not make; left as it is' };
    }
    const managed = managedRoles(r, slug ?? '', companyRoleExists);
    const current = await r.admin.userRealmRoles(user.id);
    await r.admin.removeRealmRoles(user.id, current.filter((x) => managed.has(x.name)));
    if (slug) {
      const root = companyRoot(slug);
      for (const g of await r.admin.userGroups(user.id)) {
        if (g.path === root || g.path.startsWith(`${root}/`)) await r.admin.leaveGroup(user.id, g.id);
      }
    }
    if (ProvisionerService.adopted(user)) {
      return { status: 'absent' as const, externalId: user.id, detail: "access taken away: Kara's roles and groups removed (the account was there before Kara, so it stays enabled)" };
    }
    if (user.enabled) {
      await r.admin.updateUser(user.id, { ...user, enabled: false });
      await r.admin.logout(user.id);
    }
    return { status: 'absent' as const, externalId: user.id, detail: 'access taken away: account disabled, roles removed' };
  }
}
