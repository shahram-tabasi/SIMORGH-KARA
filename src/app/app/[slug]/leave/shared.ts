import { toJalali, toFaDigits, JALALI_MONTHS } from "@/lib/jalali";

export const KIND_LABEL: Record<string, string> = {
  leave: "مرخصی",
  mission: "مأموریت",
  hourly: "مرخصی ساعتی",
};
export const STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار تأیید",
  approved: "تأیید شده",
  rejected: "رد شده",
};
export const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

/** Approval step → required permission: مدیر بخش → کارگزینی → مدیرعامل. */
export const STEP_PERMS = ["leave.approve", "leave.approve.hr", "leave.approve.l3"];

export function stepPerm(step: number): string {
  return STEP_PERMS[Math.min(step, STEP_PERMS.length) - 1];
}

export const STEP_LABEL = ["مدیر بخش", "کارگزینی", "مدیرعامل"];

export function parseIso(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function faDate(d: string): string {
  const j = toJalali(parseIso(d));
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(j.jy)}`;
}
