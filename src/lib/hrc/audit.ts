import "server-only";
import type { TransactionSql } from "postgres";
import { sql, withTenant } from "@/lib/db";

/**
 * ثبت حسابرسی.
 *
 * Anyone who looks at where an employee is, or what their heart rate was,
 * leaves a trace. That is what makes the monitoring defensible: the employee
 * can be told exactly who looked, when, and why. Writing this must never be
 * optional at the call site, so the read helpers in `operator.ts` do it
 * themselves rather than trusting each route to remember.
 */

export interface AuditEntry {
  actorMemberId: string | null;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  subjectMemberId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

export async function auditIn(tx: TransactionSql, e: AuditEntry): Promise<void> {
  await tx`
    INSERT INTO hrc_audit_log
      (actor_member_id, action, resource, resource_id, subject_member_id, ip, meta)
    VALUES (${e.actorMemberId}, ${e.action}, ${e.resource ?? null},
            ${e.resourceId ?? null}, ${e.subjectMemberId ?? null}, ${e.ip ?? null},
            ${tx.json((e.meta ?? {}) as never)})
  `;
}

export async function audit(schema: string, e: AuditEntry): Promise<void> {
  await withTenant(schema, (tx) => auditIn(tx, e));
}

/** Client IP as the proxy reports it — best effort, never trusted for auth. */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 60);
  return req.headers.get("x-real-ip")?.slice(0, 60) ?? null;
}

/** Retention sweep — deletes data past the company's own policy horizon. */
export async function runRetention(schema: string): Promise<{
  locations: number;
  heartbeats: number;
  health: number;
  events: number;
}> {
  return withTenant(schema, async (tx) => {
    const [p] = await tx<
      {
        retention_location_days: number;
        retention_event_days: number;
        retention_heartbeat_days: number;
        retention_health_days: number;
      }[]
    >`SELECT retention_location_days, retention_event_days,
             retention_heartbeat_days, retention_health_days
      FROM hrc_policies WHERE id = 1`;
    if (!p) return { locations: 0, heartbeats: 0, health: 0, events: 0 };

    // hrc_last_position keeps its own copy of the newest fix, so pruning
    // history never blanks the live map.
    const loc = await tx`
      DELETE FROM hrc_locations
      WHERE recorded_at < now() - make_interval(days => ${p.retention_location_days})
        AND id NOT IN (SELECT location_id FROM hrc_last_position WHERE location_id IS NOT NULL)
    `;
    const hb = await tx`
      DELETE FROM hrc_heartbeats
      WHERE recorded_at < now() - make_interval(days => ${p.retention_heartbeat_days})
    `;
    const hr = await tx`
      DELETE FROM hrc_health_readings
      WHERE recorded_at < now() - make_interval(days => ${p.retention_health_days})
    `;
    // Closed events only: an open incident is never swept out from under the
    // people still working it.
    const ev = await tx`
      DELETE FROM hrc_events
      WHERE occurred_at < now() - make_interval(days => ${p.retention_event_days})
        AND status = 'CLOSED'
    `;
    return {
      locations: loc.count,
      heartbeats: hb.count,
      health: hr.count,
      events: ev.count,
    };
  });
}

/** Every tenant schema that has the HRC v2 tables. */
export async function hrcSchemas(): Promise<string[]> {
  const rows = await sql<{ schema_name: string }[]>`
    SELECT schema_name FROM platform.companies
    WHERE status <> 'suspended' AND 'hrc' = ANY(modules)
  `;
  return rows.map((r) => r.schema_name);
}
