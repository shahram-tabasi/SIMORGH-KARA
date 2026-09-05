import "server-only";
import type { TransactionSql } from "postgres";
import { getSession } from "@/lib/auth";
import { sql, withTenant } from "@/lib/db";
import { normalizeModules, hasModule } from "@/lib/modules";
import type { PermissionKey } from "@/lib/rbac";
import { unauthorized, forbidden, notFound } from "./http";
import { effectivePermissions } from "./members";
import { auditIn, clientIp } from "./audit";

/**
 * سمت اپراتور — مرکز فرماندهی و پنل وب.
 *
 * Unlike device traffic, these calls carry the ordinary browser session and go
 * through the same three-layer authorisation the rest of the app uses:
 * panel entitlement → roles → per-person overrides. There is no second
 * permission system for HRC.
 */

export interface OperatorContext {
  companyId: string;
  slug: string;
  schema: string;
  name: string;
  memberId: string;
  memberName: string;
  permissions: Set<string>;
  ip: string | null;
}

export async function requireOperator(req: Request): Promise<OperatorContext> {
  const session = await getSession();
  if (!session || session.kind !== "tenant" || !session.slug) {
    throw unauthorized("وارد سامانه نشده‌اید");
  }
  const [company] = await sql<
    { id: string; name: string; slug: string; schema_name: string; status: string; modules: string[] | null }[]
  >`SELECT id, name, slug, schema_name, status, modules
    FROM platform.companies WHERE slug = ${session.slug}`;
  if (!company || company.status === "suspended") throw unauthorized("شرکت فعال نیست");

  const modules = normalizeModules(company.modules);
  if (!hasModule(modules, "hrc")) {
    throw forbidden("پنل HRC برای این شرکت فعال نیست");
  }

  const member = await withTenant(company.schema_name, async (tx) => {
    const [m] = await tx<{ id: string; full_name: string; status: string }[]>`
      SELECT id, full_name, status FROM members WHERE account_id = ${session.sub}
    `;
    if (!m || m.status !== "active") return null;
    return { ...m, perms: await effectivePermissions(tx, m.id, modules) };
  });
  if (!member) throw unauthorized("عضو فعال این شرکت نیستید");

  return {
    companyId: company.id,
    slug: company.slug,
    schema: company.schema_name,
    name: company.name,
    memberId: member.id,
    memberName: member.full_name,
    permissions: member.perms,
    ip: clientIp(req),
  };
}

export function must(ctx: OperatorContext, ...keys: PermissionKey[]): void {
  if (!keys.some((k) => ctx.permissions.has(k))) {
    throw forbidden(`این کار به دسترسی ${keys.join(" یا ")} نیاز دارد`);
  }
}

/* ─────────────────────────── incident lifecycle ──────────────────────────── */

/**
 * The only legal moves. Reopening a closed incident is deliberately not one of
 * them: a closed file stays closed, and a new problem gets a new file with its
 * own number, so the audit trail never rewrites history.
 */
const INCIDENT_FLOW: Record<string, string[]> = {
  OPEN: ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "CLOSED"],
  ACKNOWLEDGED: ["INVESTIGATING", "RESOLVED", "CLOSED"],
  INVESTIGATING: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (INCIDENT_FLOW[from] ?? []).includes(to);
}

/** The permission each transition needs — acknowledging is not resolving. */
export function permissionForTransition(to: string): PermissionKey {
  return to === "ACKNOWLEDGED" || to === "INVESTIGATING"
    ? "hrc.incidents.ack"
    : "hrc.incidents.respond";
}

export async function loadIncident(
  tx: TransactionSql,
  id: string
): Promise<{ id: string; status: string; severity: string; member_id: string | null }> {
  const [inc] = await tx<
    { id: string; status: string; severity: string; member_id: string | null }[]
  >`SELECT id, status, severity, member_id FROM hrc_incidents WHERE id = ${id}`;
  if (!inc) throw notFound("پروندهٔ حادثه یافت نشد");
  return inc;
}

/**
 * Move an incident, and move its events with it. The two must not drift: an
 * operator who closes the file expects the alert to stop flashing.
 */
export async function transitionIncident(
  tx: TransactionSql,
  ctx: OperatorContext,
  id: string,
  to: string,
  note: string | null
): Promise<{ from: string; to: string }> {
  const inc = await loadIncident(tx, id);
  if (inc.status === to) return { from: inc.status, to };
  if (!canTransition(inc.status, to)) {
    throw forbidden(`تغییر وضعیت از ${inc.status} به ${to} مجاز نیست`);
  }

  await tx`
    UPDATE hrc_incidents SET
      status = ${to},
      acknowledged_at = CASE WHEN ${to} = 'ACKNOWLEDGED' AND acknowledged_at IS NULL
                             THEN now() ELSE acknowledged_at END,
      resolved_at = CASE WHEN ${to} = 'RESOLVED' AND resolved_at IS NULL
                         THEN now() ELSE resolved_at END,
      closed_at = CASE WHEN ${to} = 'CLOSED' AND closed_at IS NULL
                       THEN now() ELSE closed_at END,
      resolution_note = COALESCE(${note}, resolution_note)
    WHERE id = ${id}
  `;

  const events = await tx<{ id: string; status: string }[]>`
    SELECT id, status FROM hrc_events WHERE incident_id = ${id}
  `;
  for (const e of events) {
    if (e.status === to) continue;
    await tx`UPDATE hrc_events SET status = ${to} WHERE id = ${e.id}`;
    await tx`
      INSERT INTO hrc_event_transitions (event_id, from_status, to_status, actor_id, note)
      VALUES (${e.id}, ${e.status}, ${to}, ${ctx.memberId}, ${note})
    `;
  }

  await auditIn(tx, {
    actorMemberId: ctx.memberId,
    action: `incident.${to.toLowerCase()}`,
    resource: "hrc_incidents",
    resourceId: id,
    subjectMemberId: inc.member_id,
    ip: ctx.ip,
    meta: { from: inc.status, to },
  });
  return { from: inc.status, to };
}

/**
 * Reading where a colleague is, or what their vitals were, is itself an act
 * that gets logged. Callers cannot forget to do it because the read helper
 * does it for them.
 */
export async function auditPeopleRead(
  tx: TransactionSql,
  ctx: OperatorContext,
  action: string,
  subjectIds: string[]
): Promise<void> {
  await auditIn(tx, {
    actorMemberId: ctx.memberId,
    action,
    resource: "members",
    subjectMemberId: subjectIds.length === 1 ? subjectIds[0] : null,
    ip: ctx.ip,
    meta: { count: subjectIds.length },
  });
}
