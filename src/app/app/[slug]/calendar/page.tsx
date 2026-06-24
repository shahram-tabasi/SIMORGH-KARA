import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { ensureYearHolidays } from "@/lib/holiday-sync";
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
    const holidays = await tx<{ holiday_date: string; title: string; is_official: boolean; is_off: boolean }[]>`
      SELECT holiday_date::text, title, is_official, is_off FROM holidays
    `;
    const overrides = await tx<{ override_date: string; is_working: boolean; note: string | null }[]>`
      SELECT override_date::text, is_working, note FROM schedule_overrides
    `;
    return { sched, holidays, overrides };
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

  // Auto-seed this year's official holidays on first view of a (future) year.
  await ensureYearHolidays(ctx.company.schema, jy);
  const { sched, holidays, overrides } = await loadCalendarData(ctx.company.schema);

  const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
  const holidayMap = new Map(
    holidays.map((h) => [h.holiday_date.slice(0, 10), h])
  );
  const overrideMap = new Map(
    overrides.map((o) => [o.override_date.slice(0, 10), o])
  );

  /** Effective day type, honouring HR overrides. */
  function dayKind(iso: string, weekday: number) {
    const hol = holidayMap.get(iso);
    const ov = overrideMap.get(iso);
    const officialOff = hol?.is_off ?? false; // religious/national day off
    let working: boolean;
    if (officialOff) working = false;
    else if (ov) working = ov.is_working;
    else working = workDays.has(weekday) && weekday !== 6; // Friday off
    return { hol, ov, officialOff, working };
  }

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
  let occasionCount = 0;
  for (const c of cells) {
    if (!c) continue;
    const { hol, working } = dayKind(c.iso, c.weekday);
    if (working) workCount++;
    if (hol?.is_off) holidayCount++;
    if (hol && !hol.is_off) occasionCount++;
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
            const { hol, ov, officialOff, working } = dayKind(c.iso, c.weekday);
            const isFriday = c.weekday === 6;
            const occasion = hol && !hol.is_off; // مناسبت غیرتعطیل
            const isOff = officialOff || (!working && isFriday); // red day
            const isRest = !working && !isOff; // استراحت (shift rest / off)
            const isToday =
              jy === today.jy && jm === today.jm && c.jd === today.jd;

            // holiday = red; today = green; occasion = yellow; rest = استراحت
            const tone = isOff
              ? "bg-red-50 text-red-600 border-red-100"
              : isToday
                ? "bg-green-100 text-green-800 border-green-300"
                : occasion
                  ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                  : working
                    ? "bg-green-50 text-green-700 border-green-100"
                    : "bg-slate-50 text-slate-400 border-slate-100";

            return (
              <div
                key={c.iso}
                className={`min-h-[68px] rounded-lg border p-2 ${tone} ${
                  isToday ? "ring-2 ring-green-500" : ""
                }`}
                title={ov?.note ?? hol?.title}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{toFaDigits(c.jd)}</span>
                  {occasion && (
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                  )}
                  {ov && (
                    <span className="rounded bg-sky-100 px-1 text-[8px] text-sky-700">دستی</span>
                  )}
                </div>
                {isToday && (
                  <div className="mt-0.5 text-[9px] font-medium text-green-700">امروز</div>
                )}
                {hol && (
                  <div className="mt-1 line-clamp-2 text-[10px] leading-tight">
                    {hol.title}
                  </div>
                )}
                {!hol && isFriday && !working && (
                  <div className="mt-1 text-[10px] text-red-400">تعطیل</div>
                )}
                {isRest && !isFriday && (
                  <div className="mt-1 text-[10px] text-slate-400">استراحت</div>
                )}
                {working && ov?.is_working && (
                  <div className="mt-1 text-[10px] text-sky-600">روز کاری</div>
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
            <span className="inline-block h-3 w-3 rounded bg-yellow-300" /> مناسبت
            ({toFaDigits(occasionCount)})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-green-300" /> امروز
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-slate-100" /> استراحت
          </span>
        </div>
      </div>
    </>
  );
}
