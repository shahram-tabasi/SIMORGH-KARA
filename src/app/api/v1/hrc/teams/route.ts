import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { requireOperator, must } from "@/lib/hrc/operator";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/teams — تیم‌های واکنش، برای انتخاب هنگام اعزام.
 *
 * تعداد اعزام‌های بازِ هر تیم هم برمی‌گردد تا اپراتور تیمی را که همین حالا
 * سر یک حادثهٔ دیگر است، دوباره اعزام نکند.
 */
export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.dispatch", "hrc.teams.manage", "hrc.incidents.view", "hrc.monitor");

  return withTenant(ctx.schema, async (tx) => {
    const teams = await tx`
      SELECT t.id, t.name, t.kind, t.phone, t.radio_channel, t.base_location,
             t.lat, t.lng, t.is_active,
             (SELECT count(*)::int FROM hrc_team_members tm WHERE tm.team_id = t.id) AS members,
             (SELECT count(*)::int FROM hrc_responder_assignments r
               WHERE r.team_id = t.id AND r.status IN ('ASSIGNED','ENROUTE','ONSITE')) AS busy_with
      FROM hrc_teams t
      WHERE t.is_active = true
      ORDER BY t.name
    `;
    return { teams };
  });
});
