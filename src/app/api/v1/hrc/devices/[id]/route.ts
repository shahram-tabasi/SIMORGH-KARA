import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { route, body, notFound } from "@/lib/hrc/http";
import { DevicePatch } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * PATCH — تعلیق/بازگردانی دستگاه، تغییر تخصیص، و ابطال توکن‌ها.
 *
 * تعلیق فوری است: `authenticateDevice` وضعیت ردیف را در هر درخواست می‌خواند،
 * پس توکن ۳۰ روزهٔ صادرشده از تصمیم مدیر عمر بیشتری ندارد.
 */
export async function PATCH(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.devices.manage");
    const patch = await body(r, DevicePatch);

    return withTenant(ctx.schema, async (tx) => {
      const [cur] = await tx<{ id: string; status: string; device_uid: string | null }[]>`
        SELECT id, status, device_uid FROM hrc_devices WHERE id = ${id}
      `;
      if (!cur) throw notFound("دستگاه یافت نشد");

      if (patch.status) {
        await tx`
          UPDATE hrc_devices
          SET status = ${patch.status}, is_active = ${patch.status === "ACTIVE"}
          WHERE id = ${id}
        `;
      }
      if (patch.note !== undefined) {
        await tx`UPDATE hrc_devices SET note = ${patch.note ?? null} WHERE id = ${id}`;
      }
      if (patch.revokeTokens) {
        await tx`
          UPDATE hrc_devices SET token_version = token_version + 1 WHERE id = ${id}
        `;
      }
      if (patch.memberId !== undefined) {
        await tx`
          UPDATE hrc_device_assignments SET unassigned_at = now(), assigned_by = ${ctx.memberId}
          WHERE device_id = ${id} AND unassigned_at IS NULL
        `;
        if (patch.memberId) {
          await tx`
            INSERT INTO hrc_device_assignments (device_id, member_id, priority, assigned_by)
            VALUES (${id}, ${patch.memberId}, 'PRIMARY', ${ctx.memberId})
          `;
        }
        await tx`UPDATE hrc_devices SET member_id = ${patch.memberId ?? null} WHERE id = ${id}`;
        // A device that changed hands must not keep talking as the old owner.
        await tx`UPDATE hrc_devices SET token_version = token_version + 1 WHERE id = ${id}`;
      }

      await auditIn(tx, {
        actorMemberId: ctx.memberId,
        action: "device.updated",
        resource: "hrc_devices",
        resourceId: id,
        subjectMemberId: patch.memberId ?? null,
        ip: ctx.ip,
        meta: {
          status: patch.status ?? null,
          reassigned: patch.memberId !== undefined,
          tokensRevoked: Boolean(patch.revokeTokens) || patch.memberId !== undefined,
        },
      });
      const [row] = await tx`SELECT * FROM hrc_devices WHERE id = ${id}`;
      return { device: row };
    });
  })(req);
}
