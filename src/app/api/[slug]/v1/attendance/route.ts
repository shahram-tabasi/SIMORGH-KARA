import { apiRoute, limitOf, param } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/<slug>/v1/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&member=<uuid>
 * ترددهای بازهٔ زمانی (پیش‌فرض: ۳۰ روز گذشته).
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "hr", "attendance.manage", async (tx) => {
    const from = param(req, "from");
    const to = param(req, "to");
    const member = param(req, "member");
    const limit = limitOf(req, 500);
    return tx`
      SELECT p.id, p.member_id, m.full_name, p.punched_at, p.kind, p.source,
             p.lat, p.lng
      FROM attendance_punches p
      JOIN members m ON m.id = p.member_id
      WHERE ${
        from
          ? tx`p.punched_at >= ${`${from}T00:00:00Z`}::timestamptz`
          : tx`p.punched_at >= now() - interval '30 days'`
      }
        AND ${
          to
            ? tx`p.punched_at < (${`${to}T00:00:00Z`}::timestamptz + interval '1 day')`
            : tx`true`
        }
        AND ${member ? tx`p.member_id = ${member}` : tx`true`}
      ORDER BY p.punched_at DESC
      LIMIT ${limit}
    `;
  });
}
