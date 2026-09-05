import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { route, body, notFound } from "@/lib/hrc/http";
import { IncidentPatch } from "@/lib/hrc/schemas";
import {
  requireOperator,
  must,
  transitionIncident,
  permissionForTransition,
  auditPeopleRead,
} from "@/lib/hrc/operator";

export const dynamic = "force-dynamic";

/** Next passes route params in the second argument, so these wrap `route()`. */
function idOf(ctx: { params: { id: string } }): string {
  return ctx.params.id;
}

export async function GET(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = idOf(params);
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.incidents.view", "hrc.monitor", "hrc.alerts.manage");

    return withTenant(ctx.schema, async (tx) => {
      const [inc] = await tx<Record<string, unknown>[]>`
        SELECT i.*, m.full_name AS member_name
        FROM hrc_incidents i LEFT JOIN members m ON m.id = i.member_id
        WHERE i.id = ${id}
      `;
      if (!inc) throw notFound("پروندهٔ حادثه یافت نشد");

      const events = await tx`
        SELECT id, event_type, severity, status, source_category, occurred_at,
               message, payload, confidence
        FROM hrc_events WHERE incident_id = ${id} ORDER BY occurred_at
      `;
      const transitions = await tx`
        SELECT t.from_status, t.to_status, t.note, t.at, m.full_name AS actor
        FROM hrc_event_transitions t
        LEFT JOIN members m ON m.id = t.actor_id
        WHERE t.event_id IN (SELECT id FROM hrc_events WHERE incident_id = ${id})
        ORDER BY t.at
      `;
      const responders = await tx`
        SELECT r.id, r.status, r.priority, r.role, r.note, r.outcome,
               r.assigned_at, r.enroute_at, r.onsite_at, r.closed_at,
               t.name AS team_name, m.full_name AS responder_name
        FROM hrc_responder_assignments r
        LEFT JOIN hrc_teams t ON t.id = r.team_id
        LEFT JOIN members m ON m.id = r.responder_member_id
        WHERE r.incident_id = ${id} ORDER BY r.assigned_at
      `;
      await auditPeopleRead(tx, ctx, "incident.read", [
        String(inc.member_id ?? ""),
      ].filter(Boolean));
      return { incident: inc, events, transitions, responders };
    });
  })(req);
}

/**
 * PATCH — حرکت پرونده در چرخهٔ عمر. تأیید دریافت و بستن پرونده دو دسترسی
 * جداگانه‌اند: نگهبان می‌تواند بگوید «دیدم»، ولی بستن پرونده کار امدادگر است.
 */
export async function PATCH(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = idOf(params);
  return route(async (r) => {
    const ctx = await requireOperator(r);
    const patch = await body(r, IncidentPatch);
    if (patch.status) must(ctx, permissionForTransition(patch.status));
    else must(ctx, "hrc.incidents.respond");

    return withTenant(ctx.schema, async (tx) => {
      if (patch.severity) {
        must(ctx, "hrc.incidents.respond");
        await tx`UPDATE hrc_incidents SET severity = ${patch.severity} WHERE id = ${id}`;
      }
      const moved = patch.status
        ? await transitionIncident(tx, ctx, id, patch.status, patch.resolutionNote ?? null)
        : null;
      if (!patch.status && patch.resolutionNote) {
        await tx`
          UPDATE hrc_incidents SET resolution_note = ${patch.resolutionNote} WHERE id = ${id}
        `;
      }
      const [inc] = await tx`SELECT * FROM hrc_incidents WHERE id = ${id}`;
      if (!inc) throw notFound("پروندهٔ حادثه یافت نشد");
      return { incident: inc, moved };
    });
  })(req);
}
