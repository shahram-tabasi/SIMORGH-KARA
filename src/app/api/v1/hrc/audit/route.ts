import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { requireOperator, must } from "@/lib/hrc/operator";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/audit — چه کسی به دادهٔ چه کسی نگاه کرد.
 *
 * این همان چیزی است که پایش را قابل دفاع می‌کند: کارمند می‌تواند بپرسد و
 * جواب مستند بگیرد. خواندنش خودش دسترسی جداگانه لازم دارد.
 */
export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.audit.view");

  const url = new URL(req.url);
  const subject = url.searchParams.get("member");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);

  return withTenant(ctx.schema, async (tx) => {
    const rows = await tx`
      SELECT a.id, a.action, a.resource, a.resource_id, a.ip, a.meta, a.at,
             actor.full_name AS actor_name, subject.full_name AS subject_name
      FROM hrc_audit_log a
      LEFT JOIN members actor ON actor.id = a.actor_member_id
      LEFT JOIN members subject ON subject.id = a.subject_member_id
      WHERE ${subject ? tx`a.subject_member_id = ${subject}` : tx`true`}
      ORDER BY a.at DESC LIMIT ${limit}
    `;
    return { entries: rows, count: rows.length };
  });
});
