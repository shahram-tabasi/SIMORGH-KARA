import { Injectable } from '@nestjs/common';
import { DbService } from '../infra/db.service';

export type TeamApp = 'plane' | 'mattermost';

export interface TeamAccess {
  accountId: string;
  email: string;
  fullName: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  schema: string;
  memberId: string;
  /** Kara's roles for the app (plane: member | admin | guest; mattermost: user). */
  roles: string[];
}

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

/** A stable number for the account, as GitLab user ids are (Mattermost stores it as auth_data). */
export function gitlabIdOf(accountId: string): number {
  return parseInt(accountId.replace(/-/g, '').slice(0, 13), 16);
}

/**
 * May this Kara account use Plane or Mattermost now? Only an active account,
 * active in an active company that has the app, with a role in it — the same
 * rule the provisioner applies (provisioning/plan.ts planMember).
 */
@Injectable()
export class TeamAccessService {
  constructor(private readonly db: DbService) {}

  async byEmail(email: string, app: TeamApp): Promise<TeamAccess | null> {
    const [a] = await this.db.query<{ id: string }>(`SELECT id::text FROM platform.user_accounts WHERE email = $1`, [email]);
    return a ? this.byAccount(a.id, app) : null;
  }

  async byAccount(accountId: string, app: TeamApp): Promise<TeamAccess | null> {
    const [a] = await this.db.query<{ email: string; full_name: string; status: string; company_id: string | null; slug: string; name: string;
      cstatus: string; apps: Record<string, boolean> | null; schema: string }>(`
      SELECT a.email::text, a.full_name, a.status, a.company_id::text, c.slug, c.name, c.status AS cstatus, c.apps, c.schema_name AS schema
      FROM platform.user_accounts a JOIN platform.companies c ON c.id = a.company_id WHERE a.id = $1`, [accountId]);
    if (!a || a.status !== 'active' || a.cstatus !== 'active' || !a.apps?.[app] || !SCHEMA_RE.test(a.schema)) return null;
    const [m] = await this.db.query<{ id: string; status: string }>(`SELECT id::text, status FROM "${a.schema}".members WHERE account_id = $1`, [accountId]);
    if (!m || m.status !== 'active') return null;
    const roles = (await this.db.query<{ role: string }>(`SELECT role FROM "${a.schema}".member_apps WHERE member_id = $1 AND app = $2`, [m.id, app])).map((r) => r.role);
    if (!roles.length) return null;
    return {
      accountId, email: a.email, fullName: a.full_name, companyId: a.company_id!, companySlug: a.slug, companyName: a.name,
      schema: a.schema, memberId: m.id, roles,
    };
  }

  /** The Kara account behind an app's user id (written by the provisioner and the sign-in adapter). */
  async accountOf(app: TeamApp, externalId: string): Promise<string | null> {
    const [r] = await this.db.query<{ account_id: string }>(
      `SELECT account_id::text FROM kara_team.app_identities WHERE app = $1 AND external_id = $2 AND state = 'active'`, [app, externalId]);
    return r?.account_id ?? null;
  }

  async identity(accountId: string, app: TeamApp) {
    const [r] = await this.db.query<{ external_id: string | null; username: string | null; state: string; managed: boolean }>(
      `SELECT external_id, username, state, managed FROM kara_team.app_identities WHERE account_id = $1 AND app = $2`, [accountId, app]);
    return r ?? null;
  }

  async setIdentity(accountId: string, app: TeamApp, v: { externalId: string | null; username: string | null; state: string; managed?: boolean }) {
    // An external id another account held (an app user re-used after a change of email) moves to this one.
    if (v.externalId) {
      await this.db.query(`UPDATE kara_team.app_identities SET external_id = NULL, state = 'absent', updated_at = now()
        WHERE app = $1 AND external_id = $2 AND account_id <> $3`, [app, v.externalId, accountId]);
    }
    await this.db.query(`
      INSERT INTO kara_team.app_identities (account_id, app, external_id, username, state, managed)
      VALUES ($1, $2, $3, $4, $5, coalesce($6, true))
      ON CONFLICT (account_id, app) DO UPDATE SET external_id = coalesce($3, kara_team.app_identities.external_id),
        username = coalesce($4, kara_team.app_identities.username), state = $5,
        managed = coalesce($6, kara_team.app_identities.managed), updated_at = now()`,
    [accountId, app, v.externalId, v.username, v.state, v.managed ?? null]);
  }
}
