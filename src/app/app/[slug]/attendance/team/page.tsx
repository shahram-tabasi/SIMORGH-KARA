import Link from "next/link";
import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import {
  todayJalali,
  isoDate,
  iranianWeekday,
  JALALI_MONTHS,
  WEEKDAYS,
  toFaDigits,
} from "@/lib/jalali";
import {
  computeDay,
  aggregatePunches,
  STATUS_LABEL,
  STATUS_TONE,
  formatTime,
  formatDuration,
  type PunchInput,
} from "@/lib/attendance";
import { loadMonthSheet } from "../data";
import { SheetTable } from "../SheetTable";
import { addPunchAction, deletePunchAction } from "../actions";

interface PunchRow {
  member_id: string;
  at: Date;
  kind: "in" | "out";
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
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    const punches = await tx<PunchRow[]>`
      SELECT member_id, punched_at AS at, kind FROM attendance_punches
      WHERE punched_at >= ${todayIso}::date AND punched_at < (${todayIso}::date + 1)
      ORDER BY punched_at
    `;
    return { sched, isHoliday: hol.c > 0, members, punches };
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

  const { sched, isHoliday, members, punches } = await loadToday(ctx.company.schema);
  const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
  const start = sched?.start_time ?? "08:00";
  const todayWeekday = iranianWeekday(new Date());
  const isWorkingDay = workDays.has(todayWeekday) && !isHoliday;
  const now = new Date();

  const byMember = new Map<string, PunchInput[]>();
  for (const p of punches) {
    const list = byMember.get(p.member_id);
    if (list) list.push({ at: p.at, kind: p.kind });
    else byMember.set(p.member_id, [{ at: p.at, kind: p.kind }]);
  }

  const today = todayJalali();
  const selected = searchParams.member;
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const sheet = selected
    ? await loadMonthSheet(ctx.company.schema, selected, jy, jm)
    : null;
  const selectedName = members.find((m) => m.id === selected)?.full_name;
  const daysWithPunches = sheet?.days.filter((d) => d.punches.length > 0) ?? [];

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
                <th className="pb-2 font-medium">اولین ورود</th>
                <th className="pb-2 font-medium">آخرین خروج</th>
                <th className="pb-2 font-medium">کارکرد</th>
                <th className="pb-2 font-medium">وضعیت</th>
                <th className="pb-2 font-medium">کارنامه</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const agg = aggregatePunches(byMember.get(m.id) ?? [], now);
                const res = computeDay({
                  isWorkingDay,
                  isHoliday,
                  checkIn: agg.firstIn,
                  checkOut: agg.lastOut,
                  dayOrder: 0,
                  scheduleStart: start,
                });
                return (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-700">
                      {m.full_name}
                      {agg.open && (
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />
                      )}
                    </td>
                    <td className="py-2" dir="ltr">{formatTime(agg.firstIn)}</td>
                    <td className="py-2" dir="ltr">{formatTime(agg.lastOut)}</td>
                    <td className="py-2">{formatDuration(agg.worked)}</td>
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
              افزودن تردد دستی
            </h4>
            <form
              action={addPunchAction}
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
                <label className="label">ساعت</label>
                <input name="time" type="time" className="input" dir="ltr" />
              </div>
              <div>
                <label className="label">نوع</label>
                <select name="kind" className="input" defaultValue="in">
                  <option value="in">ورود</option>
                  <option value="out">خروج</option>
                </select>
              </div>
              <button className="btn-ghost">افزودن</button>
            </form>

            {daysWithPunches.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {daysWithPunches.map((d) => (
                  <div key={d.iso} className="flex flex-wrap items-center gap-2">
                    <span className="w-32 text-xs text-slate-500">
                      {WEEKDAYS[d.weekday]} {toFaDigits(d.jd)}{" "}
                      {JALALI_MONTHS[jm - 1]}
                    </span>
                    {d.punches.map((p) => (
                      <span
                        key={p.id}
                        className={`badge flex items-center gap-1 ${
                          p.kind === "in"
                            ? "bg-green-50 text-green-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                        dir="ltr"
                      >
                        {p.kind === "in" ? "ورود" : "خروج"} {formatTime(p.at)}
                        <form action={deletePunchAction} className="inline">
                          <input type="hidden" name="slug" value={params.slug} />
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-red-500 hover:text-red-700">
                            ×
                          </button>
                        </form>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <SheetTable
            sheet={sheet}
            jy={jy}
            jm={jm}
            navBase={`/app/${params.slug}/attendance/team?member=${selected}`}
            slug={params.slug}
            interactive={false}
          />
        </>
      )}
    </>
  );
}
