import { apiRoute } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/hrc/positions — آخرین موقعیت و علائم حیاتی هر نفر. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "hrc", "hrc.monitor", async (tx) =>
    tx`
      SELECT m.id AS member_id, m.full_name, d.serial AS device,
             r.recorded_at, r.heart_rate, r.spo2, r.body_temp, r.steps, r.battery,
             r.motion, r.lat, r.lng, r.accuracy, r.x, r.y, r.source,
             z.name AS zone
      FROM members m
      LEFT JOIN hrc_devices d ON d.member_id = m.id
      LEFT JOIN LATERAL (
        SELECT * FROM hrc_readings hr WHERE hr.member_id = m.id
        ORDER BY hr.recorded_at DESC LIMIT 1
      ) r ON true
      LEFT JOIN hrc_zones z ON z.id = r.zone_id
      WHERE m.status = 'active'
      ORDER BY m.full_name
    `
  );
}
