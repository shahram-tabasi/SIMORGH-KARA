import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import {
  JALALI_MONTHS,
  WEEKDAYS,
  jalaliMonthLength,
  toGregorian,
  toJalali,
  iranianWeekday,
  isoDate,
  toFaDigits,
  todayJalali,
} from "@/lib/jalali";

async function loadCalendarData(schema: string) {
  return withTenant(schema, async (tx) => {
    const [sched] = await tx<{ work_days: number[]; start_time: string; end_time: string; name: string }[]>`
      SELECT name, work_days, start_time, end_time FROM work_schedules
      WHERE is_default = true LIMIT 1
    `;
    const holidays = await tx<{ holiday_date: string; title: string; is_official: boolean }[]>`
      SELECT holiday_date::text, title, is_official FROM holidays
    `;
    return { sched, holidays };
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
  const { sched, holidays } = await loadCalendarData(ctx.company.schema);

  const today = todayJalali();
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
  const holidayMap = new Map(
    holidays.map((h) => [h.holiday_date.slice(0, 10), h])
  );

  const monthLen = jalaliMonthLength(jy, jm);
  const firstWeekday = iranianWeekday(toGregorian(jy, jm, 1)); // 0=Sat

  // Build cells: leading blanks + days.
  const cells: ({ jd: number; iso: string; weekday: number } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= monthLen; d++) {
    const g = toGregorian(jy, jm, d);
    cells.push({ jd: d, iso: isoDate(g), weekday: iranianWeekday(g) });
  }

  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const base = `/app/${params.slug}/calendar`;

  let workCount = 0;
  let holidayCount = 0;
  for (const c of cells) {
    if (!c) continue;
    const isHol = holidayMap.has(c.iso) || c.weekday === 6; // Friday always off
    const isWork = workDays.has(c.weekday) && !isHol;
    if (isWork) workCount++;
    if (holidayMap.has(c.iso)) holidayCount++;
  }

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

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="pb-2 text-center text-xs font-medium text-slate-400"
            >
              {w}
            </div>
          ))}

          {cells.map((c, idx) => {
            if (!c) return <div key={`b${idx}`} />;
            const hol = holidayMap.get(c.iso);
            const isFriday = c.weekday === 6;
            const isOff = !!hol || isFriday;
            const isWork = workDays.has(c.weekday) && !isOff;
            const isToday =
              jy === today.jy && jm === today.jm && c.jd === today.jd;

            const tone = isOff
              ? "bg-red-50 text-red-600 border-red-100"
              : isWork
                ? "bg-green-50 text-green-700 border-green-100"
                : "bg-slate-50 text-slate-400 border-slate-100";

            return (
              <div
                key={c.iso}
                className={`min-h-[68px] rounded-lg border p-2 ${tone} ${
                  isToday ? "ring-2 ring-brand-500" : ""
                }`}
                title={hol?.title}
              >
                <div className="text-sm font-bold">{toFaDigits(c.jd)}</div>
                {hol && (
                  <div className="mt-1 truncate text-[10px] leading-tight">
                    {hol.title}
                  </div>
                )}
                {!hol && isFriday && (
                  <div className="mt-1 text-[10px] text-red-400">تعطیل</div>
                )}
              </div>
            );
          })}
        </div>

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
            <span className="inline-block h-3 w-3 rounded bg-slate-100" /> غیرکاری
          </span>
        </div>
      </div>
    </>
  );
}
