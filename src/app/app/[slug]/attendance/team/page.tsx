import Link from "next/link";
import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import {
  todayJalali,
  isoDate,
  iranianWeekday,
  JALALI_MONTHS,
  toFaDigits,
} from "@/lib/jalali";
import {
  computeDay,
  STATUS_LABEL,
  STATUS_TONE,
  formatTime,
} from "@/lib/attendance";
import { loadMonthSheet } from "../data";
import { SheetTable } from "../SheetTable";
import { saveAttendanceAction } from "../actions";

interface Roster {
  id: string;
  full_name: string;
  check_in: Date | null;
  check_out: Date | null;
}

async function loadToday(schema: string) {
  const todayIso = isoDate(new Date());
  return withTenant(schema, async (tx) => {
    const [sched] = await tx<{ work_days: number[]; start_time: string }[]>`
      SELECT work_days, start_time FROM work_schedules WHERE is_default = true LIMIT 1
    `;
    const [hol] = await tx<{ c: number }[]>`
      SELECT count(*)::int AS c FROM holidays WHERE holiday_date = ${todayIso}
    `;
    const members = await tx<Roster[]>`
      SELECT m.id, m.full_name, a.check_in, a.check_out
      FROM members m
      LEFT JOIN attendance_days a
        ON a.member_id = m.id AND a.work_date = ${todayIso}
      WHERE m.status = 'active'
      ORDER BY m.full_name
    `;
    return { sched, isHoliday: hol.c > 0, members };
  });
}

export default async function TeamAttendancePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { member?: string; y?: string; m?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const { sched, isHoliday, members } = await loadToday(ctx.company.schema);
  const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
  const start = sched?.start_time ?? "08:00";
  const todayWeekday = iranianWeekday(new Date());
  const isWorkingDay = workDays.has(todayWeekday) && !isHoliday;

  const today = todayJalali();
  const selected = searchParams.member;
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const sheet = selected
    ? await loadMonthSheet(ctx.company.schema, selected, jy, jm)
    : null;
  const selectedName = members.find((m) => m.id === selected)?.full_name;

  return (
    <>
      <PageHeader
        title="حضور تیم"
        description="وضعیت حضور امروز اعضا و کارنامه ماهانه هر فرد"
      />

      <div className="card mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          حضور امروز ({toFaDigits(today.jd)} {JALALI_MONTHS[today.jm - 1]})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2 font-medium">عضو</th>
                <th className="pb-2 font-medium">ورود</th>
                <th className="pb-2 font-medium">خروج</th>
                <th className="pb-2 font-medium">وضعیت</th>
                <th className="pb-2 font-medium">کارنامه</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const res = computeDay({
                  isWorkingDay,
                  isHoliday,
                  checkIn: m.check_in,
                  checkOut: m.check_out,
                  dayOrder: 0,
                  scheduleStart: start,
                });
                return (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-700">
                      {m.full_name}
                    </td>
                    <td className="py-2" dir="ltr">{formatTime(m.check_in)}</td>
                    <td className="py-2" dir="ltr">{formatTime(m.check_out)}</td>
                    <td className="py-2">
                      <span className={`badge ${STATUS_TONE[res.status]}`}>
                        {STATUS_LABEL[res.status]}
                      </span>
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/app/${params.slug}/attendance/team?member=${m.id}`}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        مشاهده
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {sheet && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">
              کارنامه: {selectedName}
            </h3>
            <Link
              href={`/app/${params.slug}/attendance/team`}
              className="text-xs text-slate-500 hover:underline"
            >
              ← بازگشت به فهرست
            </Link>
          </div>

          <div className="card mb-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">
              اصلاح دستی یک روز
            </h4>
            <form
              action={saveAttendanceAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="memberId" value={selected} />
              <input type="hidden" name="jy" value={jy} />
              <input type="hidden" name="jm" value={jm} />
              <div>
                <label className="label">روز ({JALALI_MONTHS[jm - 1]})</label>
                <select name="jd" className="input w-20" defaultValue="1">
                  {sheet.days.map((d) => (
                    <option key={d.jd} value={d.jd}>
                      {d.jd}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">ورود</label>
                <input name="check_in" type="time" className="input" dir="ltr" />
              </div>
              <div>
                <label className="label">خروج</label>
                <input name="check_out" type="time" className="input" dir="ltr" />
              </div>
              <button className="btn-ghost">ذخیره</button>
              <span className="text-[11px] text-slate-400">
                خالی گذاشتن هر دو = حذف رکورد آن روز
              </span>
            </form>
          </div>

          <SheetTable
            sheet={sheet}
            jy={jy}
            jm={jm}
            navBase={`/app/${params.slug}/attendance/team?member=${selected}`}
          />
        </>
      )}
    </>
  );
}
