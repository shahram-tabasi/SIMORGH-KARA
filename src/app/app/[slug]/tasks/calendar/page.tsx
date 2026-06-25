import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import {
  JALALI_MONTHS,
  WEEKDAYS,
  jalaliMonthLength,
  toGregorian,
  iranianWeekday,
  isoDate,
  toFaDigits,
  todayJalali,
} from "@/lib/jalali";

const PRIORITY: Record<string, { dot: string; text: string }> = {
  normal: { dot: "bg-slate-400", text: "text-slate-600" },
  urgent: { dot: "bg-amber-500", text: "text-amber-700" },
  forced: { dot: "bg-red-500", text: "text-red-700" },
};

interface TaskRow {
  id: string;
  title: string;
  code: string | null;
  priority: string;
  due_date: string;
  mine_recv: boolean;
  mine_sent: boolean;
}

export default async function TasksCalendarPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { y?: string; m?: string };
}) {
  const ctx = await requireTenant(params.slug);
  const me = ctx.member.memberId;

  const today = todayJalali();
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;
  const len = jalaliMonthLength(jy, jm);
  const firstIso = isoDate(toGregorian(jy, jm, 1));
  const lastIso = isoDate(toGregorian(jy, jm, len));

  const tasks = await withTenant(ctx.company.schema, async (tx) =>
    tx<TaskRow[]>`
      SELECT DISTINCT t.id, t.title, t.code, t.priority, t.due_date::text,
             EXISTS (SELECT 1 FROM work_task_assignees a
                     WHERE a.task_id = t.id AND a.member_id = ${me}) AS mine_recv,
             (t.created_by = ${me}) AS mine_sent
      FROM work_tasks t
      LEFT JOIN work_task_assignees a ON a.task_id = t.id
      WHERE t.due_date BETWEEN ${firstIso} AND ${lastIso}
        AND (t.created_by = ${me} OR a.member_id = ${me})
      ORDER BY t.due_date::text
    `
  );

  const byDay = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const iso = t.due_date.slice(0, 10);
    const l = byDay.get(iso);
    if (l) l.push(t);
    else byDay.set(iso, [t]);
  }

  const firstWeekday = iranianWeekday(toGregorian(jy, jm, 1));
  const cells: ({ jd: number; iso: string } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= len; d++) {
    cells.push({ jd: d, iso: isoDate(toGregorian(jy, jm, d)) });
  }

  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const base = `/app/${params.slug}/tasks/calendar`;

  return (
    <>
      <PageHeader
        title="تقویم کارها"
        description="وظایف میز کار بر اساس سررسید"
      />

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <Link href={`${base}?y=${next.y}&m=${next.m}`} className="btn-ghost">
            ماه بعد ›
          </Link>
          <div className="text-lg font-bold text-slate-800">
            {JALALI_MONTHS[jm - 1]} {toFaDigits(jy)}
          </div>
          <Link href={`${base}?y=${prev.y}&m=${prev.m}`} className="btn-ghost">
            ‹ ماه قبل
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-2 text-center text-xs font-medium text-slate-400">
              {w}
            </div>
          ))}

          {cells.map((c, idx) => {
            if (!c) return <div key={`b${idx}`} />;
            const dayTasks = byDay.get(c.iso) ?? [];
            const isToday = jy === today.jy && jm === today.jm && c.jd === today.jd;
            return (
              <div
                key={c.iso}
                className={`min-h-[88px] rounded-lg border p-1.5 ${
                  isToday ? "border-green-300 bg-green-50" : "border-slate-100 bg-white"
                }`}
              >
                <div className="mb-1 text-xs font-bold text-slate-500">
                  {toFaDigits(c.jd)}
                </div>
                <div className="space-y-1">
                  {dayTasks.map((t) => {
                    const p = PRIORITY[t.priority] ?? PRIORITY.normal;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-1 rounded bg-slate-50 px-1 py-0.5"
                        title={`${t.title}${t.code ? ` (${t.code})` : ""} — ${t.mine_sent ? "ارسالی" : "دریافتی"}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.dot}`} />
                        <span className={`truncate text-[10px] ${p.text}`}>{t.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400" /> عادی
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> ضروری
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" /> فوری/اجباری
          </span>
          <Link href={`/app/${params.slug}/tasks`} className="text-brand-600 hover:underline">
            رفتن به میز کار ›
          </Link>
        </div>
      </div>
    </>
  );
}
