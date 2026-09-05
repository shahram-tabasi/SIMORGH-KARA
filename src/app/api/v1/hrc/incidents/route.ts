import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { requireOperator, must, auditPeopleRead } from "@/lib/hrc/operator";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/incidents?status=OPEN&limit=50
 *
 * فهرست پرونده‌های حادثه برای مرکز فرماندهی. خواندن این فهرست یعنی دیدن اینکه
 * چه کسی کجا مشکل داشته، پس خودش در گزارش حسابرسی ثبت می‌شود.
 */
export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.incidents.view", "hrc.monitor", "hrc.alerts.manage");

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  return withTenant(ctx.schema, async (tx) => {
    const rows = await tx<
      {
        id: string;
        incident_no: number | null;
        severity: string;
        status: string;
        title: string | null;
        opened_at: string;
        acknowledged_at: string | null;
        resolved_at: string | null;
        member_id: string | null;
        member_name: string | null;
        event_type: string | null;
        responders: number;
      }[]
    >`
      SELECT i.id, i.incident_no, i.severity, i.status, i.title, i.opened_at,
             i.acknowledged_at, i.resolved_at, i.member_id, m.full_name AS member_name,
             e.event_type,
             (SELECT count(*)::int FROM hrc_responder_assignments r
               WHERE r.incident_id = i.id) AS responders
      FROM hrc_incidents i
      LEFT JOIN members m ON m.id = i.member_id
      LEFT JOIN hrc_events e ON e.id = i.primary_event_id
      WHERE ${status ? tx`i.status = ${status}` : tx`true`}
      ORDER BY
        CASE i.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1
                      WHEN 'INVESTIGATING' THEN 2 ELSE 3 END,
        i.opened_at DESC
      LIMIT ${limit}
    `;
    await auditPeopleRead(
      tx,
      ctx,
      "incidents.list",
      rows.map((r) => r.member_id).filter((v): v is string => Boolean(v))
    );
    return { incidents: rows, count: rows.length };
  });
});
