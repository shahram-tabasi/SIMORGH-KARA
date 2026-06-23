import { toFaDigits } from "./jalali";

/** "08:30" -> minutes from midnight (510). */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** A Date's local clock time as minutes from midnight. */
export function dateToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Local HH:MM of a timestamp, in Persian digits. */
export function formatTime(d: Date | null): string {
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return toFaDigits(`${hh}:${mm}`);
}

/** Minutes -> "۸:۳۰" style duration in Persian digits. */
export function formatDuration(min: number | null): string {
  if (min == null || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return toFaDigits(`${h}:${String(m).padStart(2, "0")}`);
}

export function workedMinutes(
  checkIn: Date | null,
  checkOut: Date | null
): number | null {
  if (!checkIn || !checkOut) return null;
  const diff = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

export type DayStatus =
  | "present"
  | "late"
  | "absent"
  | "pending"
  | "future"
  | "off"
  | "holiday";

export const STATUS_LABEL: Record<DayStatus, string> = {
  present: "حاضر",
  late: "با تأخیر",
  absent: "غایب",
  pending: "ثبت‌نشده",
  future: "—",
  off: "غیرکاری",
  holiday: "تعطیل",
};

export const STATUS_TONE: Record<DayStatus, string> = {
  present: "bg-green-100 text-green-700",
  late: "bg-amber-100 text-amber-700",
  absent: "bg-red-100 text-red-700",
  pending: "bg-slate-100 text-slate-500",
  future: "bg-white text-slate-300",
  off: "bg-slate-50 text-slate-400",
  holiday: "bg-red-50 text-red-500",
};

export interface DayComputeInput {
  isWorkingDay: boolean;
  isHoliday: boolean;
  checkIn: Date | null;
  checkOut: Date | null;
  /** 0 in the past, 0 today, +1 future relative to "now" (sign of comparison). */
  dayOrder: -1 | 0 | 1;
  scheduleStart: string; // "08:00"
  graceMinutes?: number;
}

export interface DayResult {
  status: DayStatus;
  worked: number | null;
  lateMinutes: number;
}

export function computeDay(input: DayComputeInput): DayResult {
  const { isWorkingDay, isHoliday, checkIn, checkOut, dayOrder } = input;

  if (isHoliday) return { status: "holiday", worked: null, lateMinutes: 0 };
  if (!isWorkingDay) return { status: "off", worked: null, lateMinutes: 0 };

  const worked = workedMinutes(checkIn, checkOut);

  if (checkIn) {
    const grace = input.graceMinutes ?? 0;
    const late = Math.max(
      0,
      dateToMinutes(checkIn) - timeToMinutes(input.scheduleStart) - grace
    );
    return {
      status: late > 0 ? "late" : "present",
      worked,
      lateMinutes: late,
    };
  }

  if (dayOrder < 0) return { status: "absent", worked: null, lateMinutes: 0 };
  if (dayOrder === 0) return { status: "pending", worked: null, lateMinutes: 0 };
  return { status: "future", worked: null, lateMinutes: 0 };
}
