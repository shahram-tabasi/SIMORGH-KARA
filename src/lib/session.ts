import "server-only";
import { redirect } from "next/navigation";
import { sql, withTenant } from "./db";
import { getSession, type SessionData } from "./auth";
import { filterByModules, type PermissionKey } from "./rbac";
import {
  normalizeModules,
  hasModule as moduleEnabled,
  type ModuleKey,
} from "./modules";

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

export interface HoldingContext {
  session: SessionData;
  holding: { id: string; name: string; slug: string; modules: ModuleKey[] };
}

/** Loads the holding context: verifies a holding session and resolves it. */
export async function requireHolding(): Promise<HoldingContext> {
  const session = await getSession();
  if (!session || session.kind !== "holding" || !session.holdingId) {
    redirect("/login");
  }
  const [holding] = await sql<
    { id: string; name: string; slug: string; modules: string[] | null }[]
  >`
    SELECT id, name, slug, modules FROM platform.holdings WHERE id = ${session.holdingId}
  `;
  if (!holding) redirect("/login");
  return {
    session,
    holding: {
      id: holding.id,
      name: holding.name,
      slug: holding.slug,
      modules: normalizeModules(holding.modules),
    },
  };
}

export interface MemberContext {
  memberId: string;
  fullName: string;
  permissions: Set<string>;
}

export interface TenantContext {
  session: SessionData;
  company: {
    id: string;
    name: string;
    slug: string;
    schema: string;
    /** Panels enabled for this company (set by the platform/holding admin). */
    modules: ModuleKey[];
  };
  member: MemberContext;
}

/**
 * Loads the tenant context for the current request: verifies the session is a
 * tenant session, confirms the company matches the URL slug, and resolves the
 * member record together with their effective permissions.
 *
 * Effective permissions = (union of role permissions
 *                          + per-person grants − per-person denies)
 *                         ∩ (permissions of the company's enabled panels)
 */
export async function requireTenant(slug: string): Promise<TenantContext> {
  const session = await getSession();
  if (!session || session.kind !== "tenant" || session.slug !== slug) {
    redirect("/login");
  }

  const [company] = await sql<
    {
      id: string;
      name: string;
      slug: string;
      schema_name: string;
      status: string;
      modules: string[] | null;
    }[]
  >`
    SELECT id, name, slug, schema_name, status, modules
    FROM platform.companies WHERE slug = ${slug}
  `;
  if (!company || company.status === "suspended") {
    redirect("/login?error=company");
  }
  const modules = normalizeModules(company.modules);

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
    // Per-person overrides — the «جز به جز» layer on top of the roles.
    const overrides = await tx<{ permission_key: string; effect: string }[]>`
      SELECT permission_key, effect FROM member_permissions
      WHERE member_id = ${m.id}
    `;
    const granted = new Set(perms.map((p) => p.permission_key));
    for (const o of overrides) {
      if (o.effect === "grant") granted.add(o.permission_key);
      else granted.delete(o.permission_key);
    }
    return {
      memberId: m.id,
      fullName: m.full_name,
      // A panel that is switched off for the company is unusable even if an
      // older role still carries its keys.
      permissions: filterByModules(granted, modules),
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
      modules,
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

/**
 * Page-level guard. A missing panel or permission is a normal situation (the
 * company never bought that panel, or this person was not given the key), so it
 * sends the user back to their dashboard with an explanation instead of
 * throwing an error page. Server *actions* keep using ensureModule /
 * ensurePermission, which throw.
 */
export function guardPanel(
  ctx: TenantContext,
  module: ModuleKey,
  ...keys: PermissionKey[]
): void {
  const ok =
    moduleEnabled(ctx.company.modules, module) &&
    (keys.length === 0 || keys.some((k) => ctx.member.permissions.has(k)));
  if (!ok) redirect(`/app/${ctx.company.slug}?denied=${module}`);
}

/** Allow the page when the member holds *any* of the listed keys. */
export function ensureAnyPermission(
  ctx: TenantContext,
  keys: PermissionKey[]
): void {
  if (!keys.some((k) => ctx.member.permissions.has(k))) {
    throw new Error("شما مجوز انجام این عملیات را ندارید.");
  }
}

/** True when the company has the panel switched on. */
export function hasModule(ctx: TenantContext, key: ModuleKey): boolean {
  return moduleEnabled(ctx.company.modules, key);
}

/**
 * Guard a whole panel. Used at the top of every page/action of an optional
 * module so a disabled panel 404s instead of half-rendering.
 */
export function ensureModule(ctx: TenantContext, key: ModuleKey): void {
  if (!hasModule(ctx, key)) {
    throw new Error("این پنل برای شرکت شما فعال نشده است.");
  }
}

/** Convenience for pages: require the panel *and* one of its permissions. */
export function ensureModulePermission(
  ctx: TenantContext,
  module: ModuleKey,
  key: PermissionKey
): void {
  ensureModule(ctx, module);
  ensurePermission(ctx, key);
}
