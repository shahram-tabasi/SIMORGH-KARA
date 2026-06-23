import "server-only";
import { withTenant } from "@/lib/db";
import {
  jalaliMonthLength,
  toGregorian,
  iranianWeekday,
  isoDate,
} from "@/lib/jalali";
import { computeDay, type DayResult } from "@/lib/attendance";

export interface SheetDay {
  jd: number;
  weekday: number; // 0=Sat..6=Fri
  iso: string;
  isWorkingDay: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
  checkIn: Date | null;
  checkOut: Date | null;
  result: DayResult;
}

export interface MonthSheet {
  days: SheetDay[];
  scheduleStart: string;
  scheduleName: string;
  totals: { presentDays: number; absentDays: number; workedMinutes: number; lateMinutes: number };
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
      { name: string; work_days: number[]; start_time: string }[]
    >`
      SELECT ws.name, ws.work_days, ws.start_time
      FROM work_schedules ws
      WHERE ws.id = (SELECT schedule_id FROM members WHERE id = ${memberId})
      UNION ALL
      SELECT ws.name, ws.work_days, ws.start_time
      FROM work_schedules ws WHERE ws.is_default = true
      LIMIT 1
    `;
    const workDays = new Set(sched?.work_days ?? [0, 1, 2, 3, 4]);
    const start = sched?.start_time ?? "08:00";

    const holidays = await tx<{ holiday_date: string; title: string }[]>`
      SELECT holiday_date::text, title FROM holidays
      WHERE holiday_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    const holidayMap = new Map(
      holidays.map((h) => [h.holiday_date.slice(0, 10), h.title])
    );

    const rows = await tx<
      { work_date: string; check_in: Date | null; check_out: Date | null }[]
    >`
      SELECT work_date::text, check_in, check_out
      FROM attendance_days
      WHERE member_id = ${memberId}
        AND work_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    const rowMap = new Map(rows.map((r) => [r.work_date.slice(0, 10), r]));

    const days: SheetDay[] = [];
    const totals = { presentDays: 0, absentDays: 0, workedMinutes: 0, lateMinutes: 0 };

    for (let d = 1; d <= len; d++) {
      const g = toGregorian(jy, jm, d);
      const iso = isoDate(g);
      const weekday = iranianWeekday(g);
      const isHoliday = holidayMap.has(iso) || weekday === 6; // Friday off
      const isWorkingDay = workDays.has(weekday) && !isHoliday;
      const row = rowMap.get(iso);
      const checkIn = row?.check_in ?? null;
      const checkOut = row?.check_out ?? null;
      const dayOrder = iso < todayIso ? -1 : iso === todayIso ? 0 : 1;

      const result = computeDay({
        isWorkingDay,
        isHoliday,
        checkIn,
        checkOut,
        dayOrder,
        scheduleStart: start,
      });

      if (result.status === "present" || result.status === "late")
        totals.presentDays++;
      if (result.status === "absent") totals.absentDays++;
      if (result.worked) totals.workedMinutes += result.worked;
      totals.lateMinutes += result.lateMinutes;

      days.push({
        jd: d,
        weekday,
        iso,
        isWorkingDay,
        isHoliday,
        holidayTitle: holidayMap.get(iso),
        checkIn,
        checkOut,
        result,
      });
    }

    return {
      days,
      scheduleStart: start,
      scheduleName: sched?.name ?? "—",
      totals,
    };
  });
}
