import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { KcUser, KeycloakAdmin } from '../auth/keycloak';
import { DbService } from '../infra/db.service';
import { IdentityService } from '../identity/identity.service';
import { companyRoot } from './plan';
import { ProvisionerService } from './provisioner.service';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

/**
 * A company and everything of it, removed for good (a platform admin's
 * decision, confirmed by typing the company's slug):
 *
 *   Keycloak  realm kara and every app realm: the company's organization,
 *             its group tree and company role, and the accounts Kara made
 *             for its people (an account that was there before Kara — a
 *             staff account — only loses what Kara gave it).
 *   Odoo      what Kara made in its Odoo company is archived; the company
 *             and its accounting stay (OdooSync.archiveCompany).
 *   Kara      its schema (members, units, leave, attendance, kartabl,
 *             knowledge, …), its accounts, jobs and the company row. Platform
 *             and holding administrators are never deleted with it: they
 *             only lose the link.
 *
 * The outside steps go first and each one's outcome is reported; a step
 * that fails does not stop the rest, and Kara's data is removed last, so a
 * failure can be cleaned up by hand with the report in front of you.
 */
@Injectable()
export class CompanyDeleteService {
  private readonly log = new Logger(CompanyDeleteService.name);

  constructor(private readonly db: DbService, private readonly provisioner: ProvisionerService, private readonly identity: IdentityService) {}

  async delete(slug: string, confirm: string, opts: { outside: boolean }): Promise<{ report: string[] }> {
    if (confirm !== slug) throw new BadRequestException('type the company slug to confirm');
    const [c] = await this.db.query<{ id: string; slug: string; schema: string; odoo: number | null }>(
      `SELECT id::text, slug, schema_name AS schema, odoo_company_id AS odoo FROM platform.companies WHERE slug = $1`, [slug]);
    if (!c) throw new NotFoundException(`no company ${slug}`);
    if (!SCHEMA_RE.test(c.schema)) throw new Error(`unexpected schema ${c.schema}`);

    // Its people: the accounts that belong to it (not the platform's or a holding's administrators).
    const people = await this.db.query<{ id: string; email: string }>(`
      SELECT id::text, email::text FROM platform.user_accounts
      WHERE company_id = $1 AND NOT is_platform_admin AND NOT is_holding_admin`, [c.id]);
    const report: string[] = [`company ${slug}: ${people.length} account(s) of its own`];

    if (opts.outside) {
      const realms: { name: string; admin: KeycloakAdmin }[] = [
        ...(this.identity.admin.configured ? [{ name: 'kc:kara', admin: this.identity.admin }] : []),
        ...this.provisioner.realms.map((r) => ({ name: r.target, admin: r.admin })),
      ];
      for (const r of realms) report.push(await this.step(`${r.name}`, () => this.clearRealm(r.admin, slug, people)));
      if (c.odoo) report.push(await this.step('odoo', () => this.provisioner.odoo.archiveCompany(c.odoo!)));
    } else {
      report.push('Keycloak and Odoo left as they are (not asked)');
    }

    await this.db.tx(async (t) => {
      await t.query(`UPDATE platform.user_accounts SET company_id = NULL WHERE company_id = $1 AND (is_platform_admin OR is_holding_admin)`, [c.id]);
      const ids = people.map((p) => p.id);
      await t.query(`DELETE FROM platform.provisioning_state WHERE entity_id = ANY($1::uuid[]) OR entity_id = $2`, [ids, c.id]);
      await t.query(`DELETE FROM platform.provisioning_jobs WHERE company_id = $1 OR entity_id = ANY($2::uuid[])`, [c.id, ids]);
      await t.query(`DELETE FROM platform.user_accounts WHERE id = ANY($1::uuid[])`, [ids]);
      await t.query(`DROP SCHEMA IF EXISTS "${c.schema}" CASCADE`);
      await t.query(`DELETE FROM platform.companies WHERE id = $1`, [c.id]);
    });
    report.push(`kara: schema ${c.schema}, ${people.length} account(s) and the company removed`);
    this.log.warn(`company ${slug} deleted: ${report.join(' | ')}`);
    return { report };
  }

  private async step(name: string, run: () => Promise<string>): Promise<string> {
    try {
      return `${name}: ${await run()}`;
    } catch (e) {
      return `${name}: FAILED — ${(e as Error).message}`;
    }
  }

  private async clearRealm(admin: KeycloakAdmin, slug: string, people: { id: string; email: string }[]): Promise<string> {
    let deleted = 0;
    let kept = 0;
    for (const p of people) {
      const { body } = await admin.request<KcUser[]>('GET', `/users?q=${encodeURIComponent(`karaId:${p.id}`)}&exact=true&briefRepresentation=false`);
      const user = body.find((u) => u.attributes?.karaId?.includes(p.id)) ?? await admin.userByEmail(p.email);
      if (!user) continue;
      const ours = user.attributes?.karaId?.includes(p.id) && !user.attributes?.karaAdopted?.includes('true');
      if (ours) {
        await admin.request('DELETE', `/users/${user.id}`, undefined, [404]);
        deleted++;
      } else {
        await admin.logout(user.id);
        kept++;
      }
    }
    const org = await admin.organizationByAlias(slug);
    if (org) await admin.request('DELETE', `/organizations/${org.id}`, undefined, [404]);
    const root = await admin.groupByPath(companyRoot(slug));
    if (root) await admin.deleteGroup(root.id);
    const role = await admin.realmRole(slug);
    if (role) await admin.request('DELETE', `/roles/${encodeURIComponent(slug)}`, undefined, [404]);
    return `${deleted} account(s) deleted, ${kept} older account(s) kept (signed out)${org ? ', organization' : ''}${root ? ', group tree' : ''}${role ? ', company role' : ''} removed`;
  }
}
