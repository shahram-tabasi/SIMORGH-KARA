import { withTenant } from "@/lib/db";
import { route, body } from "@/lib/hrc/http";
import { PolicyPatch } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.policy.manage", "hrc.monitor", "hrc.view");
  return withTenant(ctx.schema, async (tx) => {
    const [policy] = await tx`SELECT * FROM hrc_policies WHERE id = 1`;
    return { policy };
  });
});

/**
 * PATCH — تغییر سیاست پایش و مدت نگهداشت.
 *
 * تغییر حالت پایش تصمیم کوچکی نیست: انتخاب ALWAYS یعنی موقعیت کارمند بیرون از
 * شیفت هم ذخیره می‌شود. برای همین دسترسی جداگانه دارد و همیشه در گزارش
 * حسابرسی ثبت می‌شود.
 */
export const PATCH = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.policy.manage");
  const p = await body(req, PolicyPatch);

  return withTenant(ctx.schema, async (tx) => {
    const [before] = await tx<{ monitoring_mode: string }[]>`
      SELECT monitoring_mode FROM hrc_policies WHERE id = 1
    `;
    const [policy] = await tx`
      UPDATE hrc_policies SET
        monitoring_mode = COALESCE(${p.monitoringMode ?? null}, monitoring_mode),
        retention_location_days = COALESCE(${p.retentionLocationDays ?? null}, retention_location_days),
        retention_event_days = COALESCE(${p.retentionEventDays ?? null}, retention_event_days),
        retention_heartbeat_days = COALESCE(${p.retentionHeartbeatDays ?? null}, retention_heartbeat_days),
        retention_health_days = COALESCE(${p.retentionHealthDays ?? null}, retention_health_days),
        consent_required = COALESCE(${p.consentRequired ?? null}, consent_required),
        updated_at = now()
      WHERE id = 1 RETURNING *
    `;
    await auditIn(tx, {
      actorMemberId: ctx.memberId,
      action: "policy.updated",
      resource: "hrc_policies",
      ip: ctx.ip,
      meta: { from: before?.monitoring_mode ?? null, to: p.monitoringMode ?? null },
    });
    return { policy };
  });
});
