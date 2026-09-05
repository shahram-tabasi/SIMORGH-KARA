import { withTenant } from "@/lib/db";
import { route, body } from "@/lib/hrc/http";
import { ZoneUpsert } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.zones.manage", "hrc.map.manage", "hrc.monitor", "hrc.view");
  return withTenant(ctx.schema, async (tx) => {
    const zones = await tx`
      SELECT id, name, zone_type, shape, color, coord_mode, polygon, center_lat,
             center_lng, radius_m, building, floor, alert_on_enter, alert_on_exit,
             is_active, note, created_at
      FROM hrc_zones ORDER BY name
    `;
    return { zones };
  });
});

/**
 * POST — ساخت ناحیه. مختصات به‌صورت JSON واقعی ذخیره می‌شود (`tx.json`)، نه
 * رشتهٔ JSON — وگرنه ژئوفنس هیچ‌وقت نقطه‌ای را داخل ناحیه پیدا نمی‌کند.
 */
export const POST = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.zones.manage", "hrc.map.manage");
  const z = await body(req, ZoneUpsert);

  return withTenant(ctx.schema, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO hrc_zones
        (name, kind, zone_type, shape, color, coord_mode, polygon, center_lat,
         center_lng, radius_m, building, floor, alert_on_enter, alert_on_exit,
         is_active, note)
      VALUES
        (${z.name}, 'area', ${z.zoneType}, ${z.shape}, ${z.color}, 'geo',
         ${tx.json(z.polygon as never)}, ${z.centerLat ?? null}, ${z.centerLng ?? null},
         ${z.radiusM ?? null}, ${z.building ?? null}, ${z.floor ?? null},
         ${z.alertOnEnter}, ${z.alertOnExit}, ${z.isActive}, ${z.note ?? null})
      RETURNING id
    `;
    await auditIn(tx, {
      actorMemberId: ctx.memberId,
      action: "zone.created",
      resource: "hrc_zones",
      resourceId: row.id,
      ip: ctx.ip,
      meta: { name: z.name, zoneType: z.zoneType },
    });
    return { id: row.id };
  });
});
