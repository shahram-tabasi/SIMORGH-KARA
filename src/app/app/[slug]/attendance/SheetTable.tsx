import Link from "next/link";
import {
  JALALI_MONTHS,
  WEEKDAYS,
  toFaDigits,
  isoDate,
} from "@/lib/jalali";
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatTime,
  formatDuration,
} from "@/lib/attendance";
import type { MonthSheet } from "./data";

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
      {/* header: month nav + compact summary on one line */}
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
          <Stat label="حاضر" value={toFaDigits(t.presentDays)} tone="text-green-700" />
          <Stat label="غایب" value={toFaDigits(t.absentDays)} tone="text-red-700" />
          <Stat label="کارکرد" value={formatDuration(t.workedMinutes)} tone="text-brand-700" />
          <Stat label="تأخیر" value={formatDuration(t.lateMinutes)} tone="text-amber-700" />
          <Stat label="کسرکار" value={formatDuration(t.deficitMinutes)} tone="text-rose-700" />
          <Stat label="اضافه‌کار" value={formatDuration(t.overtimeMinutes)} tone="text-indigo-700" />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-100">
        <table className="w-full text-[11px] leading-tight">
          <thead>
            <tr className="bg-slate-100 text-right text-[10px] text-slate-500">
              <Th>روز</Th>
              <Th>تاریخ</Th>
              <Th>شیفت</Th>
              <Th>ورود</Th>
              <Th>خروج</Th>
              <Th>کارکرد</Th>
              <Th>تأخیر</Th>
              <Th>کسرکار</Th>
              <Th>اضافه‌کار</Th>
              <Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            {sheet.days.map((d, i) => {
              const isToday = d.iso === todayIso;
              const off = d.isHoliday || !d.isWorkingDay;
              const rowTone = isToday
                ? "bg-brand-50"
                : d.isHoliday
                  ? "bg-red-50/60"
                  : off
                    ? "bg-slate-50"
                    : i % 2
                      ? "bg-white"
                      : "bg-slate-50/40";
              return (
                <tr key={d.iso} className={`border-t border-slate-100 ${rowTone}`}>
                  <td className="whitespace-nowrap px-2 py-[3px] text-slate-500">
                    {WEEKDAYS[d.weekday]}
                    {isToday && <span className="mr-1 rounded bg-brand-600 px-1 text-[9px] text-white">امروز</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-[3px]">
                    {toFaDigits(d.jd)} {JALALI_MONTHS[jm - 1]}
                    {d.holidayTitle && <span className="mr-1 text-red-500">({d.holidayTitle})</span>}
                  </td>
                  <td className="px-2 py-[3px] text-[10px] text-slate-400" dir="ltr">{d.isWorkingDay ? shift : "—"}</td>
                  <td className="px-2 py-[3px]" dir="ltr">{formatTime(d.checkIn)}</td>
                  <td className="px-2 py-[3px]" dir="ltr">{formatTime(d.checkOut)}</td>
                  <td className="px-2 py-[3px] font-medium">{formatDuration(d.result.worked)}</td>
                  <td className="px-2 py-[3px] text-amber-600">{d.result.lateMinutes > 0 ? formatDuration(d.result.lateMinutes) : "—"}</td>
                  <td className="px-2 py-[3px] text-rose-600">{d.deficitMinutes > 0 ? formatDuration(d.deficitMinutes) : "—"}</td>
                  <td className="px-2 py-[3px] text-indigo-600">{d.overtimeMinutes > 0 ? formatDuration(d.overtimeMinutes) : "—"}</td>
                  <td className="px-2 py-[3px]">
                    <span className={`badge !px-1.5 !py-0 ${STATUS_TONE[d.result.status]}`}>
                      {d.leaveLabel ?? STATUS_LABEL[d.result.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
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
