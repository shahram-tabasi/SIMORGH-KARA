import { apiRoute, limitOf, param } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/hrc/alerts?status=open — هشدارهای HRC. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "hrc", "hrc.monitor", async (tx) => {
    const status = param(req, "status");
    const limit = limitOf(req, 200);
    return tx`
      SELECT a.id, a.kind, a.severity, a.status, a.message, a.created_at,
             a.lat, a.lng, m.full_name AS member, z.name AS zone,
             (SELECT count(*)::int FROM hrc_dispatches d WHERE d.alert_id = a.id)
               AS dispatches
      FROM hrc_alerts a
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN hrc_zones z ON z.id = a.zone_id
      WHERE ${
        status === "open"
          ? tx`a.status IN ('open','ack','dispatched')`
          : status
            ? tx`a.status = ${status}`
            : tx`true`
      }
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `;
  });
}
