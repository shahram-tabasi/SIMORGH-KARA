import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { route, body, notFound } from "@/lib/hrc/http";
import { ZoneUpsert } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.zones.manage", "hrc.map.manage");
    const z = await body(r, ZoneUpsert);

    return withTenant(ctx.schema, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        UPDATE hrc_zones SET
          name = ${z.name}, zone_type = ${z.zoneType}, shape = ${z.shape},
          color = ${z.color}, polygon = ${tx.json(z.polygon as never)},
          center_lat = ${z.centerLat ?? null}, center_lng = ${z.centerLng ?? null},
          radius_m = ${z.radiusM ?? null}, building = ${z.building ?? null},
          floor = ${z.floor ?? null}, alert_on_enter = ${z.alertOnEnter},
          alert_on_exit = ${z.alertOnExit}, is_active = ${z.isActive},
          note = ${z.note ?? null}
        WHERE id = ${id} RETURNING id
      `;
      if (!row) throw notFound("ناحیه یافت نشد");
      await auditIn(tx, {
        actorMemberId: ctx.memberId, action: "zone.updated",
        resource: "hrc_zones", resourceId: id, ip: ctx.ip, meta: { name: z.name },
      });
      return { id };
    });
  })(req);
}

/**
 * DELETE — ناحیه واقعاً حذف نمی‌شود، غیرفعال می‌شود. رویدادهای گذشته به آن
 * ارجاع دارند و پاک‌کردنش یعنی خراب‌کردن تاریخچهٔ حوادث.
 */
export async function DELETE(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.zones.manage", "hrc.map.manage");
    return withTenant(ctx.schema, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        UPDATE hrc_zones SET is_active = false WHERE id = ${id} RETURNING id
      `;
      if (!row) throw notFound("ناحیه یافت نشد");
      await auditIn(tx, {
        actorMemberId: ctx.memberId, action: "zone.deactivated",
        resource: "hrc_zones", resourceId: id, ip: ctx.ip,
      });
      return { id, isActive: false };
    });
  })(req);
}
