import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { route, body, notFound, forbidden } from "@/lib/hrc/http";
import { ResponderPatch } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/** ترتیب مجاز: اعزام → در مسیر → در محل → پایان. لغو از هر جای باز ممکن است. */
const FLOW: Record<string, string[]> = {
  ASSIGNED: ["ENROUTE", "ONSITE", "DONE", "CANCELLED"],
  ENROUTE: ["ONSITE", "DONE", "CANCELLED"],
  ONSITE: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export async function PATCH(
  req: Request,
  params: { params: { id: string; assignmentId: string } }
): Promise<NextResponse> {
  const { id: incidentId, assignmentId } = params.params;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.dispatch", "hrc.incidents.respond");
    const patch = await body(r, ResponderPatch);

    return withTenant(ctx.schema, async (tx) => {
      const [cur] = await tx<{ status: string; target_member_id: string | null }[]>`
        SELECT status, target_member_id FROM hrc_responder_assignments
        WHERE id = ${assignmentId} AND incident_id = ${incidentId}
      `;
      if (!cur) throw notFound("اعزام یافت نشد");
      if (cur.status !== patch.status && !(FLOW[cur.status] ?? []).includes(patch.status)) {
        throw forbidden(`تغییر وضعیت اعزام از ${cur.status} به ${patch.status} مجاز نیست`);
      }

      await tx`
        UPDATE hrc_responder_assignments SET
          status = ${patch.status},
          outcome = COALESCE(${patch.outcome ?? null}, outcome),
          enroute_at = CASE WHEN ${patch.status} = 'ENROUTE' AND enroute_at IS NULL
                            THEN now() ELSE enroute_at END,
          onsite_at = CASE WHEN ${patch.status} = 'ONSITE' AND onsite_at IS NULL
                           THEN now() ELSE onsite_at END,
          closed_at = CASE WHEN ${patch.status} IN ('DONE','CANCELLED') AND closed_at IS NULL
                           THEN now() ELSE closed_at END
        WHERE id = ${assignmentId}
      `;
      await auditIn(tx, {
        actorMemberId: ctx.memberId,
        action: `responder.${patch.status.toLowerCase()}`,
        resource: "hrc_responder_assignments",
        resourceId: assignmentId,
        subjectMemberId: cur.target_member_id,
        ip: ctx.ip,
      });
      const [row] = await tx`
        SELECT * FROM hrc_responder_assignments WHERE id = ${assignmentId}
      `;
      return { assignment: row };
    });
  })(req);
}
