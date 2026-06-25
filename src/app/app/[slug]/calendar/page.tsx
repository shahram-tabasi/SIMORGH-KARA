import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { ensureYearHolidays } from "@/lib/holiday-sync";
import { PageHeader } from "@/components/Shell";
import { CalendarGrid, type GridDay, type GridItem } from "./CalendarGrid";
import {
  JALALI_MONTHS,
  jalaliMonthLength,
  toGregorian,
  iranianWeekday,
  isoDate,
  toFaDigits,
  todayJalali,
} from "@/lib/jalali";

async function loadCalendarData(schema: string, memberId: string, firstIso: string, lastIso: string) {
  return withTenant(schema, async (tx) => {
    const [sched] = await tx<{ work_days: number[]; start_time: string; end_time: string; name: string }[]>`
      SELECT name, work_days, start_time, end_time FROM work_schedules
      WHERE is_default = true LIMIT 1
    `;
    const holidays = await tx<{ holiday_date: string; title: string; is_official: boolean; is_off: boolean }[]>`
      SELECT holiday_date::text, title, is_official, is_off FROM holidays
    `;
    const overrides = await tx<{ override_date: string; is_working: boolean; note: string | null }[]>`
      SELECT override_date::text, is_working, note FROM schedule_overrides
    `;
    const tasks = await tx<
      { id: string; title: string; code: string | null; priority: string; due_date: string; my_status: string | null; sent: boolean }[]
    >`
      SELECT t.id, t.title, t.code, t.priority, t.due_date::text,
             mine.status AS my_status, (t.created_by = ${memberId}) AS sent
      FROM work_tasks t
      LEFT JOIN work_task_assignees mine
        ON mine.task_id = t.id AND mine.member_id = ${memberId}
      WHERE t.due_date BETWEEN ${firstIso} AND ${lastIso}
        AND (t.created_by = ${memberId} OR mine.member_id = ${memberId})
      ORDER BY t.due_date::text
    `;
    // Personal kartabl items with a reminder land on the same calendar.
    const kartabl = await tx<
      { id: string; title: string; kind: string; status: string; remind_at: string }[]
    >`
      SELECT i.id, i.title, i.kind, i.status, i.remind_at::text
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE k.member_id = ${memberId} AND i.remind_at IS NOT NULL
        AND i.remind_at::date BETWEEN ${firstIso} AND ${lastIso}
    `;
    return { sched, holidays, overrides, tasks, kartabl };
  });
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { y?: string; m?: string };
}) {
  const ctx = await requireTenant(params.slug);

  const today = todayJalali();
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const monthLen = jalaliMonthLength(jy, jm);
  const firstIso = isoDate(toGregorian(jy, jm, 1));
  const lastIso = isoDate(toGregorian(jy, jm, monthLen));

  // Auto-seed this year's official holidays on first view of a (future) year.
  await ensureYearHolidays(ctx.company.schema, jy);
  const { sched, holidays, overrides, tasks, kartabl } = await loadCalendarData(
    ctx.company.schema,
    ctx.member.memberId,
    firstIso,
    lastIso
  );

  const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
  const holidayMap = new Map(holidays.map((h) => [h.holiday_date.slice(0, 10), h]));
  const overrideMap = new Map(overrides.map((o) => [o.override_date.slice(0, 10), o]));

  // Unified items per day: میز کار tasks (priority colours) + کارتابل items
  // (a distinct violet, so they stand apart from the three task colours).
  const TASK_DOT: Record<string, string> = {
    normal: "bg-slate-400",
    urgent: "bg-amber-500",
    forced: "bg-red-500",
  };
  const norm = (s: string | null): GridItem["status"] =>
    s === "in_progress" || s === "done" ? s : "open";

  const itemsByDay = new Map<string, GridItem[]>();
  const add = (iso: string, it: GridItem) => {
    const l = itemsByDay.get(iso);
    if (l) l.push(it);
    else itemsByDay.set(iso, [it]);
  };
  for (const t of tasks) {
    add(t.due_date.slice(0, 10), {
      id: t.id,
      title: t.title,
      code: t.code,
      dot: TASK_DOT[t.priority] ?? TASK_DOT.normal,
      status: norm(t.my_status),
      canEdit: t.my_status != null,
      source: "task",
      tag: "میز کار",
      tagTone: "bg-slate-100 text-slate-500",
    });
  }
  for (const k of kartabl) {
    add(k.remind_at.slice(0, 10), {
      id: k.id,
      title: k.title,
      code: null,
      dot: "bg-violet-500",
      status: norm(k.status),
      canEdit: true, // own kartabl items
      source: "kartabl",
      tag: "کارتابل",
      tagTone: "bg-violet-100 text-violet-700",
    });
  }

  const firstWeekday = iranianWeekday(toGregorian(jy, jm, 1)); // 0=Sat

  let workCount = 0;
  let holidayCount = 0;
  let occasionCount = 0;

  const cells: (GridDay | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= monthLen; d++) {
    const g = toGregorian(jy, jm, d);
    const iso = isoDate(g);
    const weekday = iranianWeekday(g);
    const hol = holidayMap.get(iso);
    const ov = overrideMap.get(iso);
    const officialOff = hol?.is_off ?? false;
    const working = officialOff ? false : ov ? ov.is_working : workDays.has(weekday) && weekday !== 6;
    const isFriday = weekday === 6;
    const occasion = !!hol && !hol.is_off;
    const isOff = officialOff || (!working && isFriday);
    const isRest = !working && !isOff;
    const isToday = jy === today.jy && jm === today.jm && d === today.jd;

    if (working) workCount++;
    if (hol?.is_off) holidayCount++;
    if (occasion) occasionCount++;

    const tone = isOff
      ? "bg-red-50 text-red-600 border-red-100"
      : isToday
        ? "bg-green-100 text-green-800 border-green-300"
        : occasion
          ? "bg-yellow-100 text-yellow-800 border-yellow-300"
          : working
            ? "bg-green-50 text-green-700 border-green-100"
            : "bg-slate-50 text-slate-400 border-slate-100";

    cells.push({
      jd: d,
      iso,
      tone,
      ring: isToday,
      hol: hol?.title,
      note: ov?.note ?? undefined,
      occasion,
      ov: !!ov,
      friHoliday: !hol && isFriday && !working,
      rest: isRest && !isFriday,
      today: isToday,
      items: itemsByDay.get(iso) ?? [],
    });
  }

  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const base = `/app/${params.slug}/calendar`;

  return (
    <>
      <PageHeader
        title="تقویم کاری"
        description={
          sched
            ? `شیفت پیش‌فرض: ${sched.name} — ${toFaDigits(sched.start_time)} تا ${toFaDigits(sched.end_time)}`
            : "هنوز شیفت کاری تعریف نشده است"
        }
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

        <CalendarGrid slug={params.slug} cells={cells} />

        <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-green-100" /> روز کاری
            ({toFaDigits(workCount)})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-red-100" /> تعطیل
            ({toFaDigits(holidayCount)} مناسبت)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-yellow-300" /> مناسبت
            ({toFaDigits(occasionCount)})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-green-300" /> امروز
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> کار (روی روز نگه دارید)
          </span>
        </div>
      </div>
    </>
  );
}
