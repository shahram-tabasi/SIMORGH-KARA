import Link from "next/link";
import {
  JALALI_MONTHS,
  WEEKDAYS,
  toFaDigits,
  isoDate,
} from "@/lib/jalali";
import { formatDuration } from "@/lib/attendance";
import type { MonthSheet, SheetDay, DayStamp } from "./data";

/** Colored chronological clock stamps: ۸:۰۰ ۱۱:۰۰ ۱۲:۰۰ ۱۷:۰۰ */
function Timeline({ stamps }: { stamps: DayStamp[] }) {
  if (stamps.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" dir="ltr">
      {stamps.map((s, i) => (
        <span
          key={i}
          className={`font-semibold tabular-nums ${
            s.kind === "in"
              ? "text-emerald-600"
              : s.kind === "out"
                ? "text-rose-500"
                : "text-blue-600"
          }`}
          title={s.kind === "leave" ? "مرز مرخصی ساعتی" : s.kind === "in" ? "ورود" : "خروج"}
        >
          {s.display}
        </span>
      ))}
    </span>
  );
}

/** Vibrant status chip + meaning for a day. */
function dayStatus(d: SheetDay): { text: string; cls: string } {
  if (d.holidayWork) return { text: "کار در تعطیل", cls: "bg-indigo-100 text-indigo-700" };
  if (d.leaveLabel) return { text: d.leaveLabel, cls: "bg-blue-100 text-blue-700" };
  switch (d.result.status) {
    case "present":
      return { text: "حاضر", cls: "bg-emerald-100 text-emerald-700" };
    case "late":
      return { text: "با تأخیر", cls: "bg-amber-100 text-amber-700" };
    case "leave":
      return { text: "مرخصی", cls: "bg-blue-100 text-blue-700" };
    case "mission":
      return { text: "مأموریت", cls: "bg-purple-100 text-purple-700" };
    case "absent":
      return { text: "غایب", cls: "bg-red-100 text-red-700" };
    case "holiday":
      // official holiday (has a title) vs the weekly Friday rest
      return d.holidayTitle
        ? { text: d.holidayTitle, cls: "bg-rose-100 text-rose-700" }
        : { text: "تعطیل هفتگی", cls: "bg-rose-50 text-rose-500" };
    case "off":
      return { text: "استراحت", cls: "bg-sky-100 text-sky-700" };
    case "pending":
      return { text: "ثبت‌نشده", cls: "bg-slate-100 text-slate-400" };
    default:
      return { text: "—", cls: "bg-white text-slate-300" };
  }
}

export function SheetTable({
  sheet,
  jy,
  jm,
  navBase,
}: {
  sheet: MonthSheet;
  jy: number;
  jm: number;
  navBase: string;
}) {
  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const sep = navBase.includes("?") ? "&" : "?";
  const todayIso = isoDate(new Date());
  const shift = `${toFaDigits(sheet.scheduleStart)}–${toFaDigits(sheet.scheduleEnd)}`;
  const t = sheet.totals;

  return (
    <div className="card !p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={`${navBase}${sep}y=${next.y}&m=${next.m}`} className="btn-ghost !px-2 !py-1 text-xs">›</Link>
          <div className="text-center">
            <span className="text-sm font-bold text-slate-800">{JALALI_MONTHS[jm - 1]} {toFaDigits(jy)}</span>
            <span className="mr-1 text-[10px] text-slate-400">({sheet.scheduleName} · {shift})</span>
          </div>
          <Link href={`${navBase}${sep}y=${prev.y}&m=${prev.m}`} className="btn-ghost !px-2 !py-1 text-xs">‹</Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Stat label="حاضر" value={toFaDigits(t.presentDays)} tone="text-emerald-600" />
          <Stat label="غایب" value={toFaDigits(t.absentDays)} tone="text-red-600" />
          <Stat label="کارکرد" value={formatDuration(t.workedMinutes)} tone="text-brand-700" />
          <Stat label="تأخیر" value={formatDuration(t.lateMinutes)} tone="text-amber-600" />
          <Stat label="کسرکار" value={formatDuration(t.deficitMinutes)} tone="text-rose-600" />
          <Stat label="اضافه‌کار" value={formatDuration(t.overtimeMinutes)} tone="text-indigo-600" />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-[11px] leading-tight">
          <thead>
            <tr className="bg-brand-700 text-right text-[10px] text-white">
              <Th>روز</Th><Th>تاریخ</Th><Th>شیفت</Th><Th>ترددها</Th>
              <Th>کارکرد</Th><Th>تأخیر</Th><Th>کسرکار</Th><Th>اضافه‌کار</Th><Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            {sheet.days.map((d, i) => {
              const isToday = d.iso === todayIso;
              const s = dayStatus(d);
              const rowTone = isToday
                ? "bg-brand-50"
                : d.holidayTitle
                  ? "bg-rose-50"
                  : d.result.status === "holiday"
                    ? "bg-rose-50/40"
                    : !d.isWorkingDay
                      ? "bg-sky-50/40"
                      : i % 2
                        ? "bg-white"
                        : "bg-slate-50/50";
              return (
                <tr key={d.iso} className={`border-t border-slate-100 ${rowTone}`}>
                  <td className="whitespace-nowrap px-2 py-[3px] font-medium text-slate-600">
                    {WEEKDAYS[d.weekday]}
                    {isToday && <span className="mr-1 rounded bg-brand-600 px-1 text-[9px] text-white">امروز</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-[3px] text-slate-500">
                    {toFaDigits(d.jd)} {JALALI_MONTHS[jm - 1]}
                  </td>
                  <td className="px-2 py-[3px] text-[10px] text-slate-400" dir="ltr">{d.isWorkingDay ? shift : "—"}</td>
                  <td className="px-2 py-[3px]">
                    <Timeline stamps={d.stamps} />
                    {d.hourlyLeave && (
                      <span className="mr-1 rounded bg-blue-50 px-1 text-[9px] text-blue-600">م. ساعتی</span>
                    )}
                  </td>
                  <td className="px-2 py-[3px] font-bold text-brand-700">{formatDuration(d.result.worked)}</td>
                  <td className="px-2 py-[3px] text-amber-600">{d.result.lateMinutes > 0 ? formatDuration(d.result.lateMinutes) : "—"}</td>
                  <td className="px-2 py-[3px] text-rose-600">{d.deficitMinutes > 0 ? formatDuration(d.deficitMinutes) : "—"}</td>
                  <td className="px-2 py-[3px] text-indigo-600">
                    {d.overtimeMinutes > 0 ? formatDuration(d.overtimeMinutes) : "—"}
                    {d.holidayWork && <span className="mr-1 text-[8px] text-indigo-400">×۱.۴</span>}
                  </td>
                  <td className="px-2 py-[3px]">
                    <span className={`inline-block rounded px-1.5 py-[1px] text-[10px] font-medium ${s.cls}`}>{s.text}</span>
                    {d.holidayWork && d.holidayTitle && (
                      <span className="mr-1 text-[9px] text-rose-500">{d.holidayTitle}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-brand-200 bg-brand-50 text-[11px] font-bold text-slate-700">
              <td className="px-2 py-1" colSpan={3}>جمع ماه</td>
              <td className="px-2 py-1"></td>
              <td className="px-2 py-1 text-brand-700">{formatDuration(t.workedMinutes)}</td>
              <td className="px-2 py-1 text-amber-600">{formatDuration(t.lateMinutes)}</td>
              <td className="px-2 py-1 text-rose-600">{formatDuration(t.deficitMinutes)}</td>
              <td className="px-2 py-1 text-indigo-600">{formatDuration(t.overtimeMinutes)}</td>
              <td className="px-2 py-1 text-emerald-600">{toFaDigits(t.presentDays)} حاضر</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1 font-medium">{children}</th>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-slate-400">{label}</span>
      <b className={tone}>{value}</b>
    </span>
  );
}
