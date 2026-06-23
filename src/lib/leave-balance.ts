import "server-only";
import { withTenant, type Tx } from "./db";
import {
  toGregorian,
  toJalali,
  jalaliMonthLength,
  iranianWeekday,
  isoDate,
} from "./jalali";
import { timeToMinutes } from "./attendance";

export const SITE_MINUTES: Record<string, number> = {
  hq: 510, // دفتر مرکزی ۰۸:۳۰
  factory: 440, // کارخانه ۰۷:۲۰
  guard: 510, // نگهبان (بر اساس شیفت؛ پیش‌فرض)
};

export const SITE_LABEL: Record<string, string> = {
  hq: "دفتر مرکزی",
  factory: "کارخانه",
  guard: "نگهبانی",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseIso(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/* ----------------------------- effective days ---------------------------- */

export interface EffectiveDaysArgs {
  unit: "day" | "hour";
  countsInnerHolidays: boolean;
  fromIso: string;
  toIso: string;
  fromTime?: string | null;
  toTime?: string | null;
  holidays: Set<string>; // official-holiday iso dates inside the range
  dailyMinutes: number;
}

/**
 * Billable leave amount in *days*. Day-unit leave skips inner Fridays and
 * official holidays unless the type counts them (تبصره۱). Hourly leave is
 * converted to a day fraction using the member's daily working minutes
 * (کارخانه ۰۷:۲۰ / دفتر ۰۸:۳۰).
 */
export function computeEffectiveDays(args: EffectiveDaysArgs): number {
  if (args.unit === "hour") {
    if (!args.fromTime || !args.toTime) return 0;
    const mins = timeToMinutes(args.toTime) - timeToMinutes(args.fromTime);
    if (mins <= 0) return 0;
    return round2(mins / args.dailyMinutes);
  }

  const start = parseIso(args.fromIso);
  const end = parseIso(args.toIso);
  let count = 0;
  for (let i = 0; i <= dayDiff(start, end); i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoDate(d);
    const isHoliday = args.holidays.has(iso) || iranianWeekday(d) === 6;
    if (args.countsInnerHolidays || !isHoliday) count++;
  }
  return count;
}

/** Official-holiday iso set within [fromIso, toIso]. */
export async function holidaysInRange(
  tx: Tx,
  fromIso: string,
  toIso: string
): Promise<Set<string>> {
  const rows = await tx<{ holiday_date: string }[]>`
    SELECT holiday_date::text FROM holidays
    WHERE holiday_date BETWEEN ${fromIso} AND ${toIso}
  `;
  return new Set(rows.map((r) => r.holiday_date.slice(0, 10)));
}

/* ------------------------------- balances -------------------------------- */

export interface LeaveBalance {
  jyear: number;
  hireDate: string;
  dailyMinutes: number;
  annual: number;
  accrued: number; // earned so far this year (prorated)
  used: number; // approved entitlement-deducting leave this year
  carriedIn: number; // stored carry-over from prior years
  adjustments: number; // manual adjustments / buy-backs (signed)
  remaining: number;
}

/** Day-prorated annual accrual within a Jalali year, up to today. */
export function proratedAccrual(hireDate: Date, jyear: number, annual: number): number {
  const yearStart = toGregorian(jyear, 1, 1);
  const yearEnd = toGregorian(jyear, 12, jalaliMonthLength(jyear, 12));
  const nextStart = toGregorian(jyear + 1, 1, 1);
  const yearLen = dayDiff(yearStart, nextStart);

  const today = new Date();
  const start = hireDate > yearStart ? hireDate : yearStart;
  const end = today < yearEnd ? today : yearEnd;
  if (end < start) return 0;

  const serviceDays = dayDiff(start, end) + 1;
  return round2((annual * serviceDays) / yearLen);
}

export async function loadBalance(
  schema: string,
  memberId: string,
  jyear: number
): Promise<LeaveBalance> {
  return withTenant(schema, async (tx) => {
    const [emp] = await tx<{ hire_date: string; daily_work_minutes: number }[]>`
      SELECT hire_date::text, daily_work_minutes
      FROM member_employment WHERE member_id = ${memberId}
    `;
    const hireIso = emp?.hire_date?.slice(0, 10) ?? isoDate(new Date());
    const dailyMinutes = emp?.daily_work_minutes ?? 510;

    const [pol] = await tx<{ annual_leave_days: string }[]>`
      SELECT annual_leave_days FROM attendance_policy WHERE id = 1
    `;
    const annual = Number(pol?.annual_leave_days ?? 30);

    const accrued = proratedAccrual(parseIso(hireIso), jyear, annual);

    // Used: approved, entitlement-deducting requests whose start date is in jyear.
    const reqs = await tx<{ from_date: string; effective_days: string | null }[]>`
      SELECT lr.from_date::text, lr.effective_days
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.type_id
      WHERE lr.member_id = ${memberId} AND lr.status = 'approved'
        AND lt.deducts_entitlement = true
    `;
    let used = 0;
    for (const r of reqs) {
      if (toJalali(parseIso(r.from_date)).jy === jyear)
        used += Number(r.effective_days ?? 0);
    }

    const ledger = await tx<{ kind: string; days: string }[]>`
      SELECT kind, days FROM leave_ledger
      WHERE member_id = ${memberId} AND jyear = ${jyear}
    `;
    let carriedIn = 0;
    let adjustments = 0;
    for (const l of ledger) {
      if (l.kind === "carry_in") carriedIn += Number(l.days);
      else adjustments += Number(l.days);
    }

    const remaining = round2(accrued + carriedIn + adjustments - used);
    return {
      jyear,
      hireDate: hireIso,
      dailyMinutes,
      annual,
      accrued,
      used: round2(used),
      carriedIn: round2(carriedIn),
      adjustments: round2(adjustments),
      remaining,
    };
  });
}

export interface MemberBalanceRow {
  memberId: string;
  name: string;
  balance: LeaveBalance;
}

/** Entitlement balance for every active member, for a Jalali year. */
export async function loadAllBalances(
  schema: string,
  jyear: number
): Promise<MemberBalanceRow[]> {
  const members = await withTenant(schema, async (tx) =>
    tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `
  );
  const out: MemberBalanceRow[] = [];
  for (const m of members) {
    out.push({
      memberId: m.id,
      name: m.full_name,
      balance: await loadBalance(schema, m.id, jyear),
    });
  }
  return out;
}
