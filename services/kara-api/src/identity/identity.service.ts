import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { KcUser, KeycloakAdmin } from '../auth/keycloak';
import { config } from '../config';
import { identitySyncs } from '../infra/metrics';
import { Account, Tenant, TenantsService } from '../tenants/tenants.service';

export interface SyncResult {
  accountId: string;
  email: string;
  outcome: 'created' | 'updated' | 'skipped';
  organization?: string;
  invited: boolean;
  note?: string;
}

/** "Ali Reza Ahmadi" → first "Ali Reza", last "Ahmadi"; one word stays first. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export const brokered = (email: string, domains = config.keycloak.brokeredDomains) =>
  domains.some(d => email.toLowerCase().endsWith(`@${d.toLowerCase()}`));

/**
 * Kara accounts in Keycloak (realm kara): one user per account, enabled while
 * the account and its tenant are active, a member of the tenant's
 * organization (alias = tenant slug). Kara keeps who belongs where and with
 * which rights; Keycloak only proves who someone is.
 */
@Injectable()
export class IdentityService {
  private readonly log = new Logger(IdentityService.name);
  readonly admin = new KeycloakAdmin();

  constructor(private readonly tenants: TenantsService) {}

  async sync(account: Account, opts: { invite: boolean; password?: string }): Promise<SyncResult> {
    if (!this.admin.configured) throw new ServiceUnavailableException('Keycloak admin client is not configured (KEYCLOAK_CLIENT_SECRET)');
    const base = { accountId: account.id, email: account.email };
    if (brokered(account.email)) {
      identitySyncs.inc({ outcome: 'skipped' });
      return { ...base, outcome: 'skipped', invited: false, note: 'signs in through the staff identity provider' };
    }
    const tenant: Tenant | undefined = account.companyId ? await this.tenants.tenantById(account.companyId) : undefined;
    const enabled = account.status === 'active' && tenant?.status !== 'suspended';
    const names = splitName(account.fullName);

    let user: KcUser | undefined = await this.admin.userByEmail(account.email);
    let outcome: SyncResult['outcome'];
    if (!user) {
      // Kara verified the address when the account was made by an admin.
      const id = await this.admin.createUser({ username: account.email, email: account.email, emailVerified: true, enabled, ...names });
      user = { id, username: account.email, enabled };
      outcome = 'created';
    } else {
      await this.admin.updateUser(user.id, { enabled, ...names });
      outcome = 'updated';
    }

    let organization: string | undefined;
    if (tenant) {
      const org = await this.admin.ensureOrganization(tenant.slug, tenant.name);
      await this.admin.addMember(org.id, user.id);
      organization = tenant.slug;
      // An account moved to another tenant leaves the old organization.
      for (const o of await this.admin.memberOrganizations(user.id)) {
        if (o.id !== org.id) await this.admin.removeMember(o.id, user.id);
      }
    }

    let invited = false;
    let note: string | undefined;
    if (opts.password) {
      // The admin gave a first password: no invitation; Keycloak asks for a new one at the first sign-in.
      try {
        await this.admin.setPassword(user.id, opts.password, true);
        note = 'initial password set (to be changed at the first sign-in)';
      } catch (e) {
        note = `initial password not accepted by Keycloak: ${(e as Error).message}`;
        this.log.warn(`${account.email}: ${note}`);
      }
    } else if (opts.invite && enabled && !(await this.admin.hasPassword(user.id))) {
      try {
        await this.admin.invite(user.id);
        invited = true;
      } catch (e) {
        note = `invitation not sent: ${(e as Error).message}`;
        this.log.warn(`${account.email}: ${note}`);
      }
    }
    identitySyncs.inc({ outcome });
    if (invited) identitySyncs.inc({ outcome: 'invited' });
    return { ...base, outcome, organization, invited, note };
  }

  /** Every Kara account, one by one; a failure is reported and the rest go on. */
  async syncAll(opts: { invite: boolean }): Promise<{ results: SyncResult[]; failed: { email: string; error: string }[] }> {
    const results: SyncResult[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const a of await this.tenants.allAccounts()) {
      try {
        results.push(await this.sync(a, opts));
      } catch (e) {
        identitySyncs.inc({ outcome: 'failed' });
        failed.push({ email: a.email, error: (e as Error).message });
      }
    }
    return { results, failed };
  }
}
