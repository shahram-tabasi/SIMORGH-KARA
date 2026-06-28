"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  JALALI_MONTHS,
  WEEKDAYS,
  toFaDigits,
  isoDate,
} from "@/lib/jalali";
import { formatDuration } from "@/lib/attendance";
import { registerPunchesAction } from "./actions";
import type { MonthSheet, SheetDay, DayStamp } from "./data";

function Timeline({ stamps }: { stamps: DayStamp[] }) {
  if (stamps.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" dir="ltr">
      {stamps.map((s, i) => (
        <span
          key={i}
          className={`font-semibold tabular-nums ${
            s.kind === "in" ? "text-emerald-600" : s.kind === "out" ? "text-rose-500" : "text-blue-600"
          }`}
          title={s.kind === "leave" ? "مرز مرخصی ساعتی" : s.kind === "in" ? "ورود" : "خروج"}
        >
          {s.display}
        </span>
      ))}
    </span>
  );
}

function dayStatus(d: SheetDay): { text: string; cls: string } {
  if (d.holidayWork) return { text: "کار در تعطیل", cls: "bg-indigo-100 text-indigo-700" };
  if (d.leaveLabel) return { text: d.leaveLabel, cls: "bg-blue-100 text-blue-700" };
  switch (d.result.status) {
    case "present": return { text: "حاضر", cls: "bg-emerald-100 text-emerald-700" };
    case "late": return { text: "با تأخیر", cls: "bg-amber-100 text-amber-700" };
    case "leave": return { text: "مرخصی", cls: "bg-blue-100 text-blue-700" };
    case "mission": return { text: "مأموریت", cls: "bg-purple-100 text-purple-700" };
    case "absent": return { text: "غایب", cls: "bg-red-100 text-red-700" };
    case "holiday":
      return d.holidayTitle
        ? { text: d.holidayTitle, cls: "bg-rose-100 text-rose-700" }
        : { text: "تعطیل هفتگی", cls: "bg-rose-50 text-rose-500" };
    case "off": return { text: "استراحت", cls: "bg-sky-100 text-sky-700" };
    case "pending": return { text: "ثبت‌نشده", cls: "bg-slate-100 text-slate-400" };
    default: return { text: "—", cls: "bg-white text-slate-300" };
  }
}

export function SheetTable({
  sheet,
  jy,
  jm,
  navBase,
  slug,
  interactive = true,
}: {
  sheet: MonthSheet;
  jy: number;
  jm: number;
  navBase: string;
  slug: string;
  interactive?: boolean;
}) {
  const router = useRouter();
  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const sep = navBase.includes("?") ? "&" : "?";
  const todayIso = isoDate(new Date());
  const shift = `${toFaDigits(sheet.scheduleStart)}–${toFaDigits(sheet.scheduleEnd)}`;
  const t = sheet.totals;

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [punchOpen, setPunchOpen] = useState(false);
  const [kind, setKind] = useState<"in" | "out">("in");
  const [time, setTime] = useState("08:00");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const selDays = [...sel].sort();

  function toggle(iso: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(iso)) n.delete(iso);
      else n.add(iso);
      return n;
    });
  }
  function onContext(e: React.MouseEvent) {
    if (sel.size === 0) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }
  function gotoLeave(missionKind: "leave" | "mission") {
    const from = selDays[0];
    const to = selDays[selDays.length - 1];
    setMenu(null);
    router.push(`/app/${slug}/leave?from=${from}&to=${to}&kind=${missionKind}`);
  }
  function submitPunch() {
    setMsg(null);
    start(async () => {
      const r = await registerPunchesAction(slug, selDays, kind, time);
      if (r.error) setMsg(r.error);
      else {
        setMsg(`ثبت شد: ${toFaDigits(r.added ?? 0)} روز${r.skipped ? ` · ${toFaDigits(r.skipped)} رد (سقف)` : ""}`);
        setSel(new Set());
        setPunchOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="card !p-3" onClick={() => setMenu(null)}>
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

      {interactive && (
        <div className="mb-2 flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
          <span>
            {sel.size > 0
              ? `${toFaDigits(sel.size)} روز انتخاب شد — راست‌کلیک کنید: مرخصی / مأموریت / تردد`
              : "روی روزها کلیک کنید تا انتخاب شوند، سپس راست‌کلیک کنید"}
          </span>
          {sel.size > 0 && (
            <button onClick={() => setSel(new Set())} className="text-brand-600 hover:underline">پاک‌کردن انتخاب</button>
          )}
        </div>
      )}
      {msg && <div className="mb-2 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">{msg}</div>}

      <div className="overflow-hidden rounded-md border border-slate-200" onContextMenu={interactive ? onContext : undefined}>
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
              const selected = sel.has(d.iso);
              const rowTone = selected
                ? "bg-brand-100 dark:bg-brand-500/25"
                : isToday
                  ? "bg-brand-50 dark:bg-brand-500/10"
                  : d.holidayTitle
                    ? "bg-rose-50 dark:bg-rose-500/10"
                    : d.result.status === "holiday"
                      ? "bg-rose-50/40 dark:bg-rose-500/[0.06]"
                      : !d.isWorkingDay
                        ? "bg-sky-50/40 dark:bg-sky-500/[0.06]"
                        : i % 2
                          ? "bg-white dark:bg-white/[0.02]"
                          : "bg-slate-50/50 dark:bg-transparent";
              return (
                <tr
                  key={d.iso}
                  onClick={interactive ? () => toggle(d.iso) : undefined}
                  className={`border-t border-slate-100 ${rowTone} ${interactive ? "cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-500/15" : ""}`}
                >
                  <td className="whitespace-nowrap px-2 py-[3px] font-medium text-slate-600">
                    {interactive && <span className={`mr-0.5 inline-block h-2.5 w-2.5 rounded-sm border ${selected ? "border-brand-500 bg-brand-500" : "border-slate-300"}`} />}
                    {WEEKDAYS[d.weekday]}
                    {isToday && <span className="mr-1 rounded bg-brand-600 px-1 text-[9px] text-white">امروز</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-[3px] text-slate-500">{toFaDigits(d.jd)} {JALALI_MONTHS[jm - 1]}</td>
                  <td className="px-2 py-[3px] text-[10px] text-slate-400" dir="ltr">{d.isWorkingDay ? shift : "—"}</td>
                  <td className="px-2 py-[3px]">
                    <Timeline stamps={d.stamps} />
                    {d.hourlyLeave && <span className="mr-1 rounded bg-blue-50 px-1 text-[9px] text-blue-600">م. ساعتی</span>}
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
                    {d.holidayWork && d.holidayTitle && <span className="mr-1 text-[9px] text-rose-500">{d.holidayTitle}</span>}
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

      {/* context menu */}
      {menu && (
        <div
          className="fixed z-50 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white text-right text-sm shadow-xl"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => gotoLeave("leave")} className="block w-full px-3 py-2 text-slate-700 hover:bg-blue-50">📝 ثبت مرخصی</button>
          <button onClick={() => gotoLeave("mission")} className="block w-full px-3 py-2 text-slate-700 hover:bg-purple-50">🧳 ثبت مأموریت</button>
          <button onClick={() => { setMenu(null); setPunchOpen(true); }} className="block w-full px-3 py-2 text-slate-700 hover:bg-emerald-50">⏱️ ثبت تردد</button>
        </div>
      )}

      {/* punch modal */}
      {punchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setPunchOpen(false)}>
          <div className="w-80 rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-bold text-slate-800">ثبت تردد دستی</h3>
            <p className="mb-3 text-[11px] text-slate-400">برای {toFaDigits(sel.size)} روز انتخاب‌شده</p>
            <div className="mb-3 flex gap-2">
              <button onClick={() => setKind("in")} className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${kind === "in" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>ورود</button>
              <button onClick={() => setKind("out")} className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${kind === "out" ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-500"}`}>خروج</button>
            </div>
            <label className="label">ساعت</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input mb-3" dir="ltr" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPunchOpen(false)} className="btn-ghost text-sm">انصراف</button>
              <button onClick={submitPunch} disabled={pending} className="btn-primary text-sm">{pending ? "…" : "ثبت"}</button>
            </div>
          </div>
        </div>
      )}
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
