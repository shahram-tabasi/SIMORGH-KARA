import { withTenant } from "@/lib/db";
import { route, body } from "@/lib/hrc/http";
import { RuleUpsert } from "@/lib/hrc/schemas";
import { requireOperator, must } from "@/lib/hrc/operator";
import { auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.rules.manage", "hrc.thresholds.manage", "hrc.monitor");
  return withTenant(ctx.schema, async (tx) => {
    const rules = await tx`
      SELECT id, code, name, description, enabled, priority, conditions, actions,
             severity, is_system, version, updated_at
      FROM hrc_rules ORDER BY priority, code
    `;
    const [thresholds] = await tx`SELECT * FROM hrc_thresholds WHERE id = 1`;
    return { rules, thresholds };
  });
});

/**
 * POST — ساخت یا به‌روزرسانی قانون ریسک بر اساس `code`.
 *
 * مقدار شرط می‌تواند عدد ثابت باشد یا به آستانهٔ همان شرکت اشاره کند
 * (`{"threshold":"hr_max"}`) — یعنی مدیر ایمنی می‌تواند سیاست را عوض کند بدون
 * اینکه نسخهٔ جدیدی از اپ منتشر شود.
 */
export const POST = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.rules.manage");
  const rule = await body(req, RuleUpsert);

  return withTenant(ctx.schema, async (tx) => {
    const [row] = await tx<{ id: string; version: number }[]>`
      INSERT INTO hrc_rules
        (code, name, description, enabled, priority, conditions, actions, severity, is_system)
      VALUES
        (${rule.code}, ${rule.name}, ${rule.description ?? null}, ${rule.enabled},
         ${rule.priority}, ${tx.json(rule.conditions as never)},
         ${tx.json(rule.actions as never)}, ${rule.severity}, false)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description,
        enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
        conditions = EXCLUDED.conditions, actions = EXCLUDED.actions,
        severity = EXCLUDED.severity,
        version = hrc_rules.version + 1, updated_at = now()
      RETURNING id, version
    `;
    await auditIn(tx, {
      actorMemberId: ctx.memberId, action: "rule.saved", resource: "hrc_rules",
      resourceId: row.id, ip: ctx.ip, meta: { code: rule.code, version: row.version },
    });
    return { id: row.id, code: rule.code, version: row.version };
  });
});
