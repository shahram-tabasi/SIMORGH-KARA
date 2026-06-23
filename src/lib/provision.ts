import "server-only";
import { sql, withTenant, assertSafeSchema } from "./db";
import { tenantDDL } from "./sql";
import { DEFAULT_ROLES } from "./rbac";
import { DEFAULT_LEAVE_TYPES } from "./leave-types";
import { hashPassword } from "./password";
import { slugify, shortId, schemaNameFromSlug } from "./utils";

export interface NewCompanyInput {
  name: string;
  plan?: string;
  maxUsers?: number;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface ProvisionResult {
  companyId: string;
  slug: string;
  schema: string;
  adminAccountId: string;
}

/** Find a slug not yet taken by any company. */
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 10; i++) {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM platform.companies WHERE slug = ${slug}
    `;
    if (row.count === 0) return slug;
    slug = `${base}-${shortId(4)}`;
  }
  return `${base}-${shortId(8)}`;
}

/**
 * Provision a brand-new tenant: control-plane row, dedicated schema, default
 * roles, and the company's first administrator (account + member + role).
 */
export async function provisionCompany(
  input: NewCompanyInput
): Promise<ProvisionResult> {
  const slug = await uniqueSlug(slugify(input.name));
  const schema = assertSafeSchema(schemaNameFromSlug(slug));

  // Guard: e-mail must be globally unique.
  const [existing] = await sql`
    SELECT id FROM platform.user_accounts WHERE email = ${input.adminEmail}
  `;
  if (existing) {
    throw new Error("این ایمیل قبلاً ثبت شده است.");
  }

  // 1) control-plane company row
  const [company] = await sql<{ id: string }[]>`
    INSERT INTO platform.companies (name, slug, schema_name, plan, max_users)
    VALUES (
      ${input.name}, ${slug}, ${schema},
      ${input.plan ?? "standard"}, ${input.maxUsers ?? 10}
    )
    RETURNING id
  `;
  const companyId = company.id;

  // 2) build the tenant schema (DDL template — multiple statements)
  await sql.unsafe(tenantDDL(schema));

  // 3) admin identity in the global directory
  const passwordHash = await hashPassword(input.adminPassword);
  const [account] = await sql<{ id: string }[]>`
    INSERT INTO platform.user_accounts
      (email, password_hash, full_name, company_id)
    VALUES
      (${input.adminEmail}, ${passwordHash}, ${input.adminName}, ${companyId})
    RETURNING id
  `;
  const adminAccountId = account.id;

  // 4) seed roles + the admin member inside the tenant schema
  await withTenant(schema, async (tx) => {
    const roleIdByName = new Map<string, string>();
    for (const role of DEFAULT_ROLES) {
      const [r] = await tx<{ id: string }[]>`
        INSERT INTO roles (name, description, is_system)
        VALUES (${role.name}, ${role.description}, ${role.is_system})
        RETURNING id
      `;
      roleIdByName.set(role.name, r.id);
      for (const perm of role.permissions) {
        await tx`
          INSERT INTO role_permissions (role_id, permission_key)
          VALUES (${r.id}, ${perm})
        `;
      }
    }

    const [member] = await tx<{ id: string }[]>`
      INSERT INTO members (account_id, full_name, title)
      VALUES (${adminAccountId}, ${input.adminName}, 'مدیر شرکت')
      RETURNING id
    `;

    const adminRoleId = roleIdByName.get(DEFAULT_ROLES[0].name)!;
    await tx`
      INSERT INTO member_roles (member_id, role_id)
      VALUES (${member.id}, ${adminRoleId})
    `;

    await tx`
      INSERT INTO kartabls (member_id, name)
      VALUES (${member.id}, 'کارتابل اصلی')
    `;

    await tx`
      INSERT INTO member_employment (member_id, hire_date)
      VALUES (${member.id}, current_date)
    `;

    // Default company work schedule (Sat–Wed, 08:00–17:00).
    await tx`
      INSERT INTO work_schedules (name, work_days, start_time, end_time, is_default)
      VALUES ('شیفت اداری', '{0,1,2,3,4}', '08:00', '17:00', true)
    `;

    // Default attendance policy row (30 days annual entitlement per labour law).
    await tx`
      INSERT INTO attendance_policy (id, annual_leave_days)
      VALUES (1, 30) ON CONFLICT DO NOTHING
    `;

    // Seed the configurable leave-type catalogue from labour-law defaults.
    for (const t of DEFAULT_LEAVE_TYPES) {
      await tx`
        INSERT INTO leave_types
          (code, name, unit, paid, deducts_entitlement, counts_inner_holidays,
           requires_attachment, max_minutes_per_day, max_count_per_month,
           max_count_per_week, max_days_per_year, approval_levels, sort_order,
           description, is_system)
        VALUES
          (${t.code}, ${t.name}, ${t.unit}, ${t.paid}, ${t.deducts_entitlement},
           ${t.counts_inner_holidays}, ${t.requires_attachment},
           ${t.max_minutes_per_day}, ${t.max_count_per_month},
           ${t.max_count_per_week}, ${t.max_days_per_year}, ${t.approval_levels},
           ${t.sort_order}, ${t.description}, true)
      `;
    }
  });

  return { companyId, slug, schema, adminAccountId };
}
