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
  navBase: string; // e.g. /app/co/attendance  (?y=&m= appended)
}) {
  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const sep = navBase.includes("?") ? "&" : "?";
  const todayIso = isoDate(new Date());
  const shift = `${toFaDigits(sheet.scheduleStart)}–${toFaDigits(sheet.scheduleEnd)}`;

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <Link href={`${navBase}${sep}y=${next.y}&m=${next.m}`} className="btn-ghost">
          ماه بعد ›
        </Link>
        <div className="text-center">
          <div className="text-lg font-bold text-slate-800">
            {JALALI_MONTHS[jm - 1]} {toFaDigits(jy)}
          </div>
          <div className="text-[11px] text-slate-400">
            شیفت: {sheet.scheduleName} · {shift}
          </div>
        </div>
        <Link href={`${navBase}${sep}y=${prev.y}&m=${prev.m}`} className="btn-ghost">
          ‹ ماه قبل
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Summary label="روزهای حاضر" value={toFaDigits(sheet.totals.presentDays)} tone="text-green-700" />
        <Summary label="روزهای غایب" value={toFaDigits(sheet.totals.absentDays)} tone="text-red-700" />
        <Summary label="مجموع کارکرد" value={formatDuration(sheet.totals.workedMinutes)} tone="text-brand-700" />
        <Summary label="مجموع تأخیر" value={formatDuration(sheet.totals.lateMinutes)} tone="text-amber-700" />
        <Summary label="مجموع کسرکار" value={formatDuration(sheet.totals.deficitMinutes)} tone="text-rose-700" />
        <Summary label="مجموع اضافه‌کار" value={formatDuration(sheet.totals.overtimeMinutes)} tone="text-indigo-700" />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 text-right text-xs text-slate-500">
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
                ? "bg-brand-50/70"
                : d.isHoliday
                  ? "bg-red-50/50"
                  : off
                    ? "bg-slate-50/60"
                    : i % 2
                      ? "bg-white"
                      : "bg-slate-50/30";
              return (
                <tr
                  key={d.iso}
                  className={`border-t border-slate-100 ${rowTone} hover:bg-brand-50/40`}
                >
                  <td className="px-2 py-1.5 text-slate-500">
                    {WEEKDAYS[d.weekday]}
                    {isToday && (
                      <span className="mr-1 rounded bg-brand-600 px-1 text-[10px] text-white">
                        امروز
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {toFaDigits(d.jd)} {JALALI_MONTHS[jm - 1]}
                    {d.holidayTitle && (
                      <span className="mr-1 text-[11px] text-red-500">
                        ({d.holidayTitle})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-400" dir="ltr">
                    {d.isWorkingDay ? shift : "—"}
                  </td>
                  <td className="px-2 py-1.5" dir="ltr">{formatTime(d.checkIn)}</td>
                  <td className="px-2 py-1.5" dir="ltr">{formatTime(d.checkOut)}</td>
                  <td className="px-2 py-1.5 font-medium">{formatDuration(d.result.worked)}</td>
                  <td className="px-2 py-1.5 text-amber-600">
                    {d.result.lateMinutes > 0 ? formatDuration(d.result.lateMinutes) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-rose-600">
                    {d.deficitMinutes > 0 ? formatDuration(d.deficitMinutes) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-indigo-600">
                    {d.overtimeMinutes > 0 ? formatDuration(d.overtimeMinutes) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`badge ${STATUS_TONE[d.result.status]}`}>
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
  return <th className="px-2 py-2 font-medium">{children}</th>;
}

function Summary({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-center">
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}
