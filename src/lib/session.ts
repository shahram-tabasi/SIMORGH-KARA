import "server-only";
import { redirect } from "next/navigation";
import { sql, withTenant } from "./db";
import { getSession, type SessionData } from "./auth";
import type { PermissionKey } from "./rbac";

export interface PlatformContext {
  session: SessionData;
}

export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const session = await getSession();
  if (!session || session.kind !== "platform") {
    redirect("/login");
  }
  return { session };
}

export interface MemberContext {
  memberId: string;
  fullName: string;
  permissions: Set<string>;
}

export interface TenantContext {
  session: SessionData;
  company: { id: string; name: string; slug: string; schema: string };
  member: MemberContext;
}

/**
 * Loads the tenant context for the current request: verifies the session is a
 * tenant session, confirms the company matches the URL slug, and resolves the
 * member record together with their effective permissions.
 */
export async function requireTenant(slug: string): Promise<TenantContext> {
  const session = await getSession();
  if (!session || session.kind !== "tenant" || session.slug !== slug) {
    redirect("/login");
  }

  const [company] = await sql<
    { id: string; name: string; slug: string; schema_name: string; status: string }[]
  >`
    SELECT id, name, slug, schema_name, status
    FROM platform.companies WHERE slug = ${slug}
  `;
  if (!company || company.status === "suspended") {
    redirect("/login?error=company");
  }

  const member = await withTenant(company.schema_name, async (tx) => {
    const [m] = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE account_id = ${session.sub}
    `;
    if (!m) return null;
    const perms = await tx<{ permission_key: string }[]>`
      SELECT DISTINCT rp.permission_key
      FROM member_roles mr
      JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE mr.member_id = ${m.id}
    `;
    return {
      memberId: m.id,
      fullName: m.full_name,
      permissions: new Set(perms.map((p) => p.permission_key)),
    } as MemberContext;
  });

  if (!member) redirect("/login");

  return {
    session,
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      schema: company.schema_name,
    },
    member,
  };
}

export function ensurePermission(
  ctx: TenantContext,
  key: PermissionKey
): void {
  if (!ctx.member.permissions.has(key)) {
    throw new Error("شما مجوز انجام این عملیات را ندارید.");
  }
}
