import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../infra/db.service';

export interface Account {
  id: string;
  email: string;
  fullName: string;
  status: string;
  isPlatformAdmin: boolean;
  isHoldingAdmin: boolean;
  holdingId: string | null;
  companyId: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  schema: string;
  status: string;
  holdingId: string | null;
  odooCompanyId: number | null;
}

/** Who is calling: a Kara account, and through which client. */
export interface Actor extends Account {
  kind: 'platform' | 'holding' | 'tenant';
  via: string;
}

export interface TenantAccess {
  tenant: Tenant;
  memberId: string;
  permissions: Set<string>;
}

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

const ACCOUNT_SQL = `
  SELECT id, email::text, full_name AS "fullName", status, is_platform_admin AS "isPlatformAdmin",
         is_holding_admin AS "isHoldingAdmin", holding_id AS "holdingId", company_id AS "companyId"
  FROM platform.user_accounts`;

const TENANT_SQL = `
  SELECT id, name, slug, schema_name AS schema, status, holding_id AS "holdingId", odoo_company_id AS "odooCompanyId"
  FROM platform.companies`;

/**
 * Kara's accounts and tenants, read from the platform schema kara-web keeps,
 * with the same rules as kara-web's requireTenant: a member of the tenant,
 * with the permissions of their roles.
 */
@Injectable()
export class TenantsService {
  constructor(private readonly db: DbService) {}

  async accountById(id: string): Promise<Account | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    return (await this.db.query<Account>(`${ACCOUNT_SQL} WHERE id = $1`, [id]))[0];
  }

  async accountByEmail(email: string): Promise<Account | undefined> {
    return (await this.db.query<Account>(`${ACCOUNT_SQL} WHERE email = $1`, [email]))[0];
  }

  async allAccounts(): Promise<Account[]> {
    return this.db.query<Account>(`${ACCOUNT_SQL} ORDER BY created_at`);
  }

  async tenantBySlug(slug: string): Promise<Tenant> {
    const [t] = await this.db.query<Tenant>(`${TENANT_SQL} WHERE slug = $1`, [slug]);
    if (!t) throw new NotFoundException(`no tenant ${slug}`);
    return t;
  }

  async tenantById(id: string): Promise<Tenant | undefined> {
    return (await this.db.query<Tenant>(`${TENANT_SQL} WHERE id = $1`, [id]))[0];
  }

  /** The actor as a member of the tenant `slug`, or 403. */
  async access(actor: Actor, slug: string): Promise<TenantAccess> {
    const tenant = await this.tenantBySlug(slug);
    if (actor.kind !== 'tenant' || actor.companyId !== tenant.id) throw new ForbiddenException(`not a member of ${slug}`);
    if (tenant.status === 'suspended') throw new ForbiddenException(`${slug} is suspended`);
    if (!SCHEMA_RE.test(tenant.schema)) throw new Error(`unsafe tenant schema ${tenant.schema}`);
    const s = `"${tenant.schema}"`;
    const [member] = await this.db.query<{ id: string }>(`SELECT id FROM ${s}.members WHERE account_id = $1 AND status = 'active'`, [actor.id]);
    if (!member) throw new ForbiddenException(`not a member of ${slug}`);
    const perms = await this.db.query<{ key: string }>(
      `SELECT DISTINCT rp.permission_key AS key FROM ${s}.member_roles mr
       JOIN ${s}.role_permissions rp ON rp.role_id = mr.role_id WHERE mr.member_id = $1`,
      [member.id],
    );
    return { tenant, memberId: member.id, permissions: new Set(perms.map(p => p.key)) };
  }

  async require(actor: Actor, slug: string, permission: string): Promise<TenantAccess> {
    const access = await this.access(actor, slug);
    if (!access.permissions.has(permission)) throw new ForbiddenException(`needs permission ${permission}`);
    return access;
  }

  async setOdooCompany(slug: string, odooCompanyId: number | null): Promise<Tenant> {
    await this.tenantBySlug(slug);
    await this.db.query('UPDATE platform.companies SET odoo_company_id = $2 WHERE slug = $1', [slug, odooCompanyId]);
    return this.tenantBySlug(slug);
  }

  async linkedTenants(): Promise<Tenant[]> {
    return this.db.query<Tenant>(`${TENANT_SQL} WHERE odoo_company_id IS NOT NULL ORDER BY name`);
  }
}
