import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight notification feed for the bell: tasks assigned to me that I have
 * not yet acknowledged (new work), plus kartabl approval items awaiting me.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireTenant(params.slug);
  const me = ctx.member.memberId;

  const data = await withTenant(ctx.company.schema, async (tx) => {
    const tasks = await tx<{ id: string; title: string; priority: string }[]>`
      SELECT t.id, t.title, t.priority
      FROM work_task_assignees a
      JOIN work_tasks t ON t.id = a.task_id
      WHERE a.member_id = ${me} AND a.acknowledged_at IS NULL
      ORDER BY (t.priority='forced') DESC, (t.priority='urgent') DESC, t.created_at DESC
      LIMIT 20
    `;
    const [appr] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE k.member_id = ${me} AND i.kind = 'approval' AND i.status = 'open'
    `;
    return { tasks, approvals: appr?.n ?? 0 };
  });

  return NextResponse.json({
    tasks: data.tasks,
    approvals: data.approvals,
    count: data.tasks.length + data.approvals,
  });
}
