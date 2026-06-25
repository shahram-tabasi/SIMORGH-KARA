"use client";

import { useState, useTransition } from "react";
import { toFaDigits, WEEKDAYS } from "@/lib/jalali";
import { cycleTaskStatusAction } from "../tasks/actions";

export interface GridTask {
  id: string;
  title: string;
  code: string | null;
  priority: "normal" | "urgent" | "forced";
  status: "open" | "in_progress" | "done";
  canEdit: boolean;
  sent: boolean;
}
export interface GridDay {
  jd: number;
  iso: string;
  tone: string;
  ring: boolean;
  hol?: string;
  note?: string;
  occasion: boolean;
  ov: boolean;
  ovWork: boolean;
  friHoliday: boolean;
  rest: boolean;
  today: boolean;
  tasks: GridTask[];
}

const PRIORITY_DOT: Record<string, string> = {
  normal: "bg-slate-400",
  urgent: "bg-amber-500",
  forced: "bg-red-500",
};
const STATUS_LABEL: Record<string, string> = {
  open: "باز",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
};
const STATUS_TONE: Record<string, string> = {
  open: "bg-slate-100 text-slate-500",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

function TaskRow({
  slug,
  task,
}: {
  slug: string;
  task: GridTask;
}) {
  const [pending, start] = useTransition();
  return (
    <div
      onDoubleClick={() => {
        if (task.canEdit && !pending) start(() => cycleTaskStatusAction(slug, task.id));
      }}
      className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 ${
        task.canEdit ? "cursor-pointer hover:bg-slate-50" : ""
      }`}
      title={task.canEdit ? "دوبار کلیک = تغییر وضعیت" : task.sent ? "ارسالی شما" : ""}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
        <span className="truncate text-xs text-slate-700">
          {task.title}
          {task.code && <span className="mr-1 text-[10px] text-slate-400" dir="ltr">({task.code})</span>}
        </span>
      </div>
      <span className={`shrink-0 rounded px-1 text-[10px] ${STATUS_TONE[task.status]}`}>
        {pending ? "…" : STATUS_LABEL[task.status]}
      </span>
    </div>
  );
}

export function CalendarGrid({
  slug,
  cells,
}: {
  slug: string;
  cells: (GridDay | null)[];
}) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map((w) => (
        <div key={w} className="pb-2 text-center text-xs font-medium text-slate-400">
          {w}
        </div>
      ))}

      {cells.map((c, idx) => {
        if (!c) return <div key={`b${idx}`} />;
        const hasTasks = c.tasks.length > 0;
        const showPop = hover === c.iso && (hasTasks || c.hol || c.note);
        const doneCount = c.tasks.filter((t) => t.status === "done").length;
        return (
          <div
            key={c.iso}
            className="relative"
            onMouseEnter={() => setHover(c.iso)}
            onMouseLeave={() => setHover((h) => (h === c.iso ? null : h))}
          >
            <div
              className={`min-h-[84px] rounded-lg border p-2 ${c.tone} ${
                c.ring ? "ring-2 ring-green-500" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{toFaDigits(c.jd)}</span>
                {c.occasion && <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />}
                {c.ov && <span className="rounded bg-sky-100 px-1 text-[8px] text-sky-700">دستی</span>}
              </div>
              {c.today && <div className="text-[9px] font-medium text-green-700">امروز</div>}
              {c.hol && <div className="line-clamp-1 text-[10px] leading-tight">{c.hol}</div>}
              {c.friHoliday && <div className="text-[10px] text-red-400">تعطیل</div>}
              {c.rest && <div className="text-[10px] text-slate-400">استراحت</div>}

              {/* task dots */}
              {hasTasks && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {c.tasks.slice(0, 4).map((t) => (
                    <span
                      key={t.id}
                      className={`h-2 w-2 rounded-full ${
                        t.status === "done" ? "bg-green-400" : PRIORITY_DOT[t.priority]
                      }`}
                    />
                  ))}
                  <span className="text-[9px] text-slate-500">
                    {toFaDigits(c.tasks.length)} کار
                    {doneCount > 0 && ` · ${toFaDigits(doneCount)}✓`}
                  </span>
                </div>
              )}
            </div>

            {/* hover popover */}
            {showPop && (
              <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 text-right shadow-xl">
                {(c.hol || c.note) && (
                  <div className="mb-1 border-b border-slate-100 pb-1 text-[11px] text-slate-500">
                    {c.hol}
                    {c.note && <span className="text-sky-600"> · {c.note}</span>}
                  </div>
                )}
                {hasTasks ? (
                  <>
                    <div className="space-y-0.5">
                      {c.tasks.map((t) => (
                        <TaskRow key={t.id} slug={slug} task={t} />
                      ))}
                    </div>
                    <div className="mt-1 border-t border-slate-100 pt-1 text-center text-[10px] text-slate-400">
                      دوبار کلیک روی کار = تغییر وضعیت
                    </div>
                  </>
                ) : (
                  <div className="py-1 text-center text-[11px] text-slate-400">کاری برای این روز نیست</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
