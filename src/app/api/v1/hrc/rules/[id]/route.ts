import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { z } from "zod";
import { route, body, notFound } from "@/lib/hrc/http";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * DELETE — قانون ساخته‌شدهٔ شرکت حذف می‌شود؛ قانون سیستمی فقط خاموش می‌شود.
 * حذف یک قانون سیستمی یعنی مهاجرت بعدی دوباره آن را می‌سازد و مدیر ایمنی فکر
 * می‌کند خاموشش کرده ولی نکرده.
 */
export async function DELETE(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.rules.manage");
    return withTenant(ctx.schema, async (tx) => {
      const [rule] = await tx<{ id: string; code: string; is_system: boolean }[]>`
        SELECT id, code, is_system FROM hrc_rules WHERE id = ${id}
      `;
      if (!rule) throw notFound("قانون یافت نشد");

      if (rule.is_system) {
        await tx`UPDATE hrc_rules SET enabled = false, updated_at = now() WHERE id = ${id}`;
      } else {
        await tx`DELETE FROM hrc_rules WHERE id = ${id}`;
      }
      await auditIn(tx, {
        actorMemberId: ctx.memberId,
        action: rule.is_system ? "rule.disabled" : "rule.deleted",
        resource: "hrc_rules", resourceId: id, ip: ctx.ip, meta: { code: rule.code },
      });
      return { id, code: rule.code, disabled: rule.is_system, deleted: !rule.is_system };
    });
  })(req);
}

export async function PATCH(
  req: Request,
  params: { params: { id: string } }
): Promise<NextResponse> {
  const id = params.params.id;
  return route(async (r) => {
    const ctx = await requireOperator(r);
    must(ctx, "hrc.rules.manage");
    // Only the on/off switch lives here; everything else goes through POST so
    // a rule change always bumps its version and the devices notice.
    const { enabled } = await body(r, z.object({ enabled: z.boolean() }));
    return withTenant(ctx.schema, async (tx) => {
      const [row] = await tx<{ id: string; code: string }[]>`
        UPDATE hrc_rules SET enabled = ${enabled}, updated_at = now()
        WHERE id = ${id} RETURNING id, code
      `;
      if (!row) throw notFound("قانون یافت نشد");
      await auditIn(tx, {
        actorMemberId: ctx.memberId,
        action: enabled ? "rule.enabled" : "rule.disabled",
        resource: "hrc_rules", resourceId: id, ip: ctx.ip, meta: { code: row.code },
      });
      return { id, code: row.code, enabled };
    });
  })(req);
}
