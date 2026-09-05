import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { route, body, badRequest } from "@/lib/hrc/http";
import { ResponderCreate } from "@/lib/hrc/schemas";
import { requireOperator, must, loadIncident, transitionIncident } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * POST — اعزام تیم یا نفر به حادثه.
 *
 * اعزام، خودِ پرونده را هم به «در حال بررسی» می‌برد: تیمی که در راه است یعنی
 * کسی دارد رسیدگی می‌کند، و مرکز فرماندهی نباید دو حقیقت متفاوت نشان بدهد.
 */
export async function POST(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const incidentId = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.dispatch", "hrc.incidents.respond");
    const input = await body(r, ResponderCreate);
    if (!input.teamId && !input.responderMemberId) {
      throw badRequest("حداقل یک تیم یا یک نفر باید انتخاب شود");
    }

    return withTenant(ctx.schema, async (tx) => {
      const inc = await loadIncident(tx, incidentId);
      const [primary] = await tx<{ id: string; latitude: number | null; longitude: number | null; zone_id: string | null }[]>`
        SELECT e.id, l.latitude, l.longitude, e.zone_id
        FROM hrc_events e
        LEFT JOIN hrc_locations l ON l.id = e.location_id
        WHERE e.incident_id = ${incidentId}
        ORDER BY e.occurred_at LIMIT 1
      `;
      // Fall back to where the person is now if the event carried no fix.
      const [pos] = inc.member_id
        ? await tx<{ latitude: number | null; longitude: number | null; zone_id: string | null }[]>`
            SELECT latitude, longitude, zone_id FROM hrc_last_position
            WHERE member_id = ${inc.member_id}
          `
        : [];

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO hrc_responder_assignments
          (incident_id, event_id, team_id, responder_member_id, target_member_id,
           role, status, priority, latitude, longitude, zone_id, note, assigned_by)
        VALUES
          (${incidentId}, ${primary?.id ?? null}, ${input.teamId ?? null},
           ${input.responderMemberId ?? null}, ${inc.member_id}, ${input.role ?? null},
           'ASSIGNED', ${input.priority},
           ${primary?.latitude ?? pos?.latitude ?? null},
           ${primary?.longitude ?? pos?.longitude ?? null},
           ${primary?.zone_id ?? pos?.zone_id ?? null},
           ${input.note ?? null}, ${ctx.memberId})
        RETURNING id
      `;
      if (inc.status === "OPEN" || inc.status === "ACKNOWLEDGED") {
        await transitionIncident(tx, ctx, incidentId, "INVESTIGATING", "اعزام تیم");
      }
      await auditIn(tx, {
        actorMemberId: ctx.memberId,
        action: "responder.assigned",
        resource: "hrc_responder_assignments",
        resourceId: row.id,
        subjectMemberId: inc.member_id,
        ip: ctx.ip,
        meta: { teamId: input.teamId ?? null, priority: input.priority },
      });
      return { id: row.id, incidentId, status: "ASSIGNED" };
    });
  })(req);
}
