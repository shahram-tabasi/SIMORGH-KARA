"use client";

import { useRef, useState, useTransition } from "react";
import { toFaDigits, WEEKDAYS } from "@/lib/jalali";
import { cycleTaskStatusAction } from "../tasks/actions";
import { cycleKartablStatusAction } from "../actions";

export interface GridItem {
  id: string;
  title: string;
  code: string | null;
  dot: string;        // dot colour class
  status: "open" | "in_progress" | "done";
  canEdit: boolean;
  source: "task" | "kartabl";
  tag: string;        // small label: میز کار / کارتابل
  tagTone: string;
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
  friHoliday: boolean;
  rest: boolean;
  today: boolean;
  items: GridItem[];
}

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

function ItemRow({ slug, item }: { slug: string; item: GridItem }) {
  const [pending, start] = useTransition();
  return (
    <div
      onDoubleClick={() => {
        if (!item.canEdit || pending) return;
        start(() =>
          item.source === "task"
            ? cycleTaskStatusAction(slug, item.id)
            : cycleKartablStatusAction(slug, item.id)
        );
      }}
      className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 ${
        item.canEdit ? "cursor-pointer hover:bg-slate-50" : ""
      }`}
      title={item.canEdit ? "دوبار کلیک = تغییر وضعیت" : ""}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
        <span className="truncate text-xs text-slate-700">
          {item.title}
          {item.code && <span className="mr-1 text-[10px] text-slate-400" dir="ltr">({item.code})</span>}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={`rounded px-1 text-[9px] ${item.tagTone}`}>{item.tag}</span>
        <span className={`rounded px-1 text-[10px] ${STATUS_TONE[item.status]}`}>
          {pending ? "…" : STATUS_LABEL[item.status]}
        </span>
      </div>
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow(iso: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHover(iso);
  }
  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHover(null), 180);
  }

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map((w) => (
        <div key={w} className="pb-2 text-center text-xs font-medium text-slate-400">
          {w}
        </div>
      ))}

      {cells.map((c, idx) => {
        if (!c) return <div key={`b${idx}`} />;
        const hasItems = c.items.length > 0;
        const showPop = hover === c.iso && (hasItems || c.hol || c.note);
        const doneCount = c.items.filter((t) => t.status === "done").length;
        return (
          <div
            key={c.iso}
            className="relative"
            onMouseEnter={() => openNow(c.iso)}
            onMouseLeave={closeSoon}
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

              {hasItems && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {c.items.slice(0, 5).map((t) => (
                    <span
                      key={t.id}
                      className={`h-2 w-2 rounded-full ${t.status === "done" ? "bg-green-400" : t.dot}`}
                    />
                  ))}
                  <span className="text-[9px] text-slate-500">
                    {toFaDigits(c.items.length)} مورد
                    {doneCount > 0 && ` · ${toFaDigits(doneCount)}✓`}
                  </span>
                </div>
              )}
            </div>

            {showPop && (
              <div
                className="absolute right-0 top-full z-40 w-64 rounded-xl border border-slate-200 bg-white p-2 text-right shadow-xl"
                onMouseEnter={() => openNow(c.iso)}
                onMouseLeave={closeSoon}
              >
                {(c.hol || c.note) && (
                  <div className="mb-1 border-b border-slate-100 pb-1 text-[11px] text-slate-500">
                    {c.hol}
                    {c.note && <span className="text-sky-600"> · {c.note}</span>}
                  </div>
                )}
                {hasItems ? (
                  <>
                    <div className="max-h-56 space-y-0.5 overflow-auto">
                      {c.items.map((t) => (
                        <ItemRow key={`${t.source}-${t.id}`} slug={slug} item={t} />
                      ))}
                    </div>
                    <div className="mt-1 border-t border-slate-100 pt-1 text-center text-[10px] text-slate-400">
                      دوبار کلیک روی مورد = تغییر وضعیت
                    </div>
                  </>
                ) : (
                  <div className="py-1 text-center text-[11px] text-slate-400">موردی برای این روز نیست</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
