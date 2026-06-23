import "server-only";
import { withTenant } from "@/lib/db";
import {
  jalaliMonthLength,
  toGregorian,
  iranianWeekday,
  isoDate,
} from "@/lib/jalali";
import {
  computeDay,
  aggregatePunches,
  formatTime,
  dateToMinutes,
  timeToMinutes,
  type DayResult,
} from "@/lib/attendance";
import { toFaDigits } from "@/lib/jalali";

export interface DayPunch {
  id: string;
  at: Date;
  kind: "in" | "out";
}

/** A single clock event in a day's timeline (تردد). */
export interface DayStamp {
  display: string; // HH:MM in Persian digits
  kind: "in" | "out" | "leave";
}

export interface SheetDay {
  jd: number;
  weekday: number; // 0=Sat..6=Fri
  iso: string;
  isWorkingDay: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
  leaveLabel?: string; // leave-type name for مرخصی/مأموریت days
  hourlyLeave?: { from: string; to: string }; // مرخصی ساعتی window (Persian HH:MM)
  stamps: DayStamp[]; // full ordered timeline: ورود/خروج + مرز مرخصی ساعتی
  checkIn: Date | null;
  checkOut: Date | null;
  punches: DayPunch[];
  deficitMinutes: number; // کسرکار: shortfall vs the daily working minutes
  overtimeMinutes: number; // اضافه‌کار: worked beyond the daily minutes
  result: DayResult;
}

export interface MonthSheet {
  days: SheetDay[];
  scheduleStart: string;
  scheduleEnd: string;
  scheduleName: string;
  dailyMinutes: number;
  totals: {
    presentDays: number;
    absentDays: number;
    workedMinutes: number;
    lateMinutes: number;
    deficitMinutes: number;
    overtimeMinutes: number;
  };
}

/** Build a member's attendance sheet for a Jalali month. */
export async function loadMonthSheet(
  schema: string,
  memberId: string,
  jy: number,
  jm: number
): Promise<MonthSheet> {
  const len = jalaliMonthLength(jy, jm);
  const firstIso = isoDate(toGregorian(jy, jm, 1));
  const lastIso = isoDate(toGregorian(jy, jm, len));
  const todayIso = isoDate(new Date());

  return withTenant(schema, async (tx) => {
    // member's schedule, falling back to the company default
    const [sched] = await tx<
      { name: string; work_days: number[]; start_time: string; end_time: string }[]
    >`
      SELECT ws.name, ws.work_days, ws.start_time, ws.end_time
      FROM work_schedules ws
      WHERE ws.id = (SELECT schedule_id FROM members WHERE id = ${memberId})
      UNION ALL
      SELECT ws.name, ws.work_days, ws.start_time, ws.end_time
      FROM work_schedules ws WHERE ws.is_default = true
      LIMIT 1
    `;
    const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
    const start = sched?.start_time ?? "08:00";
    const end = sched?.end_time ?? "17:00";

    const [policy] = await tx<
      { grace_minutes: number; standard_daily_minutes: number; overtime_enabled: boolean }[]
    >`
      SELECT grace_minutes, standard_daily_minutes, overtime_enabled
      FROM attendance_policy WHERE id = 1
    `;
    const grace = policy?.grace_minutes ?? 0;
    const overtimeEnabled = policy?.overtime_enabled ?? true;

    // Daily working minutes for کسرکار/اضافه‌کار: the member's own موظفی,
    // falling back to the company standard.
    const [emp] = await tx<{ daily_work_minutes: number }[]>`
      SELECT daily_work_minutes FROM member_employment WHERE member_id = ${memberId}
    `;
    const dailyMinutes =
      emp?.daily_work_minutes ?? policy?.standard_daily_minutes ?? 480;

    const holidays = await tx<{ holiday_date: string; title: string }[]>`
      SELECT holiday_date::text, title FROM holidays
      WHERE holiday_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    const holidayMap = new Map(
      holidays.map((h) => [h.holiday_date.slice(0, 10), h.title])
    );

    // Approved full-day leaves/missions overlapping the month (with type name).
    const leaves = await tx<
      { kind: string; name: string | null; from_date: string; to_date: string }[]
    >`
      SELECT lr.kind, lt.name, lr.from_date::text, lr.to_date::text
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lt.id = lr.type_id
      WHERE lr.member_id = ${memberId} AND lr.status = 'approved'
        AND lr.kind IN ('leave','mission')
        AND lr.from_date <= ${lastIso} AND lr.to_date >= ${firstIso}
    `;
    const leaveMap = new Map<string, { kind: "leave" | "mission"; name?: string }>();
    for (const lv of leaves) {
      for (let day = 1; day <= len; day++) {
        const iso = isoDate(toGregorian(jy, jm, day));
        if (iso >= lv.from_date.slice(0, 10) && iso <= lv.to_date.slice(0, 10)) {
          if (!leaveMap.has(iso))
            leaveMap.set(iso, { kind: lv.kind as "leave" | "mission", name: lv.name ?? undefined });
        }
      }
    }

    // Approved hourly leaves (مرخصی ساعتی) — a within-day window per occurrence.
    const hourly = await tx<
      { from_date: string; from_time: string | null; to_time: string | null }[]
    >`
      SELECT from_date::text, from_time, to_time
      FROM leave_requests
      WHERE member_id = ${memberId} AND status = 'approved' AND kind = 'hourly'
        AND from_time IS NOT NULL AND to_time IS NOT NULL
        AND from_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    const hourlyMap = new Map<string, { from: string; to: string }[]>();
    for (const h of hourly) {
      const iso = h.from_date.slice(0, 10);
      const list = hourlyMap.get(iso) ?? [];
      list.push({ from: h.from_time!, to: h.to_time! });
      hourlyMap.set(iso, list);
    }

    // Punches across the month (padded so timezone edges still bucket locally).
    const punches = await tx<DayPunch[]>`
      SELECT id, punched_at AS at, kind
      FROM attendance_punches
      WHERE member_id = ${memberId}
        AND punched_at >= ${firstIso}::date
        AND punched_at < (${lastIso}::date + 2)
      ORDER BY punched_at
    `;
    const punchesByDay = new Map<string, DayPunch[]>();
    for (const p of punches) {
      const iso = isoDate(p.at);
      const list = punchesByDay.get(iso);
      if (list) list.push(p);
      else punchesByDay.set(iso, [p]);
    }

    const now = new Date();
    const days: SheetDay[] = [];
    const totals = {
      presentDays: 0,
      absentDays: 0,
      workedMinutes: 0,
      lateMinutes: 0,
      deficitMinutes: 0,
      overtimeMinutes: 0,
    };

    for (let d = 1; d <= len; d++) {
      const g = toGregorian(jy, jm, d);
      const iso = isoDate(g);
      const weekday = iranianWeekday(g);
      const isHoliday = holidayMap.has(iso) || weekday === 6; // Friday off
      const isWorkingDay = workDays.has(weekday) && !isHoliday;
      const dayOrder = iso < todayIso ? -1 : iso === todayIso ? 0 : 1;

      const dayPunches = punchesByDay.get(iso) ?? [];
      const agg = aggregatePunches(dayPunches, dayOrder === 0 ? now : undefined);
      const checkIn = agg.firstIn;
      const checkOut = agg.lastOut;

      const result = computeDay({
        isWorkingDay,
        isHoliday,
        checkIn,
        checkOut,
        dayOrder,
        scheduleStart: start,
        graceMinutes: grace,
      });
      // Worked time comes from summed in→out pairs (handles lunch breaks).
      result.worked = agg.worked > 0 ? agg.worked : null;

      // An approved leave/mission overrides an otherwise empty working day.
      let leaveLabel: string | undefined;
      if (
        isWorkingDay &&
        !checkIn &&
        (result.status === "absent" || result.status === "pending")
      ) {
        const lv = leaveMap.get(iso);
        if (lv) {
          result.status = lv.kind;
          leaveLabel = lv.name;
        }
      }

      // کسرکار / اضافه‌کار vs the daily working minutes (present days only).
      // Late arrival naturally surfaces here as کسرکار (no grace on deduction).
      let deficitMinutes = 0;
      let overtimeMinutes = 0;
      if (
        (result.status === "present" || result.status === "late") &&
        result.worked != null
      ) {
        deficitMinutes = Math.max(0, dailyMinutes - result.worked);
        overtimeMinutes = overtimeEnabled
          ? Math.max(0, result.worked - dailyMinutes)
          : 0;
      }

      // Build the day's clock timeline (تردد): punches + hourly-leave boundaries,
      // ordered. This renders as e.g. ۸:۰۰ ۱۱:۰۰ ۱۲:۰۰ ۱۷:۰۰ in the sheet.
      const dayHourly = hourlyMap.get(iso) ?? [];
      const stampSeed: { min: number; stamp: DayStamp }[] = [];
      for (const p of dayPunches)
        stampSeed.push({
          min: dateToMinutes(p.at),
          stamp: { display: formatTime(p.at), kind: p.kind },
        });
      for (const hl of dayHourly) {
        stampSeed.push({ min: timeToMinutes(hl.from), stamp: { display: toFaDigits(hl.from), kind: "leave" } });
        stampSeed.push({ min: timeToMinutes(hl.to), stamp: { display: toFaDigits(hl.to), kind: "leave" } });
      }
      stampSeed.sort((a, b) => a.min - b.min);
      const stamps = stampSeed.map((s) => s.stamp);
      const hourlyLeave = dayHourly[0]
        ? { from: toFaDigits(dayHourly[0].from), to: toFaDigits(dayHourly[0].to) }
        : undefined;

      if (result.status === "present" || result.status === "late")
        totals.presentDays++;
      if (result.status === "absent") totals.absentDays++;
      if (result.worked) totals.workedMinutes += result.worked;
      totals.lateMinutes += result.lateMinutes;
      totals.deficitMinutes += deficitMinutes;
      totals.overtimeMinutes += overtimeMinutes;

      days.push({
        jd: d,
        weekday,
        iso,
        isWorkingDay,
        isHoliday,
        holidayTitle: holidayMap.get(iso),
        leaveLabel,
        hourlyLeave,
        stamps,
        deficitMinutes,
        overtimeMinutes,
        checkIn,
        checkOut,
        punches: dayPunches,
        result,
      });
    }

    return {
      days,
      scheduleStart: start,
      scheduleEnd: end,
      scheduleName: sched?.name ?? "—",
      dailyMinutes,
      totals,
    };
  });
}

export interface MemberSummary {
  memberId: string;
  name: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  workedMinutes: number;
  lateMinutes: number;
  deficitMinutes: number;
  overtimeMinutes: number;
}

/** Monthly attendance summary for every active member. */
export async function loadMonthSummaries(
  schema: string,
  jy: number,
  jm: number
): Promise<MemberSummary[]> {
  const members = await withTenant(schema, async (tx) =>
    tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `
  );
  const out: MemberSummary[] = [];
  for (const m of members) {
    const sheet = await loadMonthSheet(schema, m.id, jy, jm);
    const leaveDays = sheet.days.filter(
      (d) => d.result.status === "leave" || d.result.status === "mission"
    ).length;
    out.push({
      memberId: m.id,
      name: m.full_name,
      presentDays: sheet.totals.presentDays,
      absentDays: sheet.totals.absentDays,
      leaveDays,
      workedMinutes: sheet.totals.workedMinutes,
      lateMinutes: sheet.totals.lateMinutes,
      deficitMinutes: sheet.totals.deficitMinutes,
      overtimeMinutes: sheet.totals.overtimeMinutes,
    });
  }
  return out;
}
