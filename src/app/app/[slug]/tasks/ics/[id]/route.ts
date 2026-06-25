import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { buildICS } from "@/lib/ics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Download an assigned work task as an .ics calendar event (with a reminder),
 * so the assignee can drop it into Windows Calendar / Outlook / Google and get
 * a native reminder at the due date.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string; id: string } }
) {
  const ctx = await requireTenant(params.slug);

  const task = await withTenant(ctx.company.schema, async (tx) => {
    const [row] = await tx<
      { id: string; title: string; body: string | null; code: string | null; due_date: string | null; from_date: string | null }[]
    >`
      SELECT t.id, t.title, t.body, t.code, t.due_date::text, t.from_date::text
      FROM work_tasks t
      JOIN work_task_assignees a ON a.task_id = t.id
      WHERE t.id = ${params.id} AND a.member_id = ${ctx.member.memberId}
    `;
    return row ?? null;
  });

  if (!task) return new Response("not found", { status: 404 });

  const iso = task.due_date ?? task.from_date;
  // Event at 09:00 local on the due/start date, or now if the task has no date.
  let start: Date;
  if (iso) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    start = new Date(y, m - 1, d, 9, 0, 0);
  } else {
    start = new Date();
  }

  const ics = buildICS({
    uid: `task-${task.id}@simorgh`,
    title: task.code ? `${task.title} (${task.code})` : task.title,
    description: task.body ?? "وظیفه از میز کار سیمرغ",
    start,
    durationMin: 60,
    alarmMinBefore: 0,
    stamp: new Date(),
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="task-${task.id}.ics"`,
    },
  });
}
