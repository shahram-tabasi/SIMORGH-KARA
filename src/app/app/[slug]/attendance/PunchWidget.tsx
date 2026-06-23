"use client";

import { useFormStatus } from "react-dom";
import { punchAction } from "./actions";
import { formatTime, formatDuration } from "@/lib/attendance";

function ManualButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="btn-ghost !px-2.5 !py-1 text-[11px] text-slate-500"
      disabled={pending}
      title="ثبت دستی (در نبود دستگاه)"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function PunchWidget({
  slug,
  punches,
  workedMinutes,
}: {
  slug: string;
  punches: { at: string; kind: "in" | "out" }[];
  workedMinutes: number;
}) {
  const last = punches[punches.length - 1];
  const working = last?.kind === "in";
  const state = !last ? "idle" : working ? "in" : "done";

  return (
    <div className="card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 !py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* device source indicator */}
        <span className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          دستگاه تردد
        </span>

        <span
          className={`badge ${
            state === "in"
              ? "bg-emerald-100 text-emerald-700"
              : state === "done"
                ? "bg-slate-200 text-slate-600"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {state === "in" ? "در حال کار" : state === "done" ? "خارج شده" : "هنوز واردنشده"}
        </span>

        <span className="text-xs text-slate-500">
          کارکرد امروز: <b className="text-brand-700">{formatDuration(workedMinutes)}</b>
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {punches.length === 0 && (
            <span className="text-[11px] text-slate-400">ترددی برای امروز ثبت نشده</span>
          )}
          {punches.map((p, i) => (
            <span
              key={i}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
                p.kind === "in"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-600"
              }`}
              dir="ltr"
            >
              <span>{p.kind === "in" ? "ورود" : "خروج"}</span>
              <span className="tabular-nums">{formatTime(new Date(p.at))}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Manual fallback — secondary, real data comes from the device */}
      <form action={punchAction} className="flex items-center gap-1.5">
        <input type="hidden" name="slug" value={slug} />
        <ManualButton label={working ? "ثبت دستی خروج" : "ثبت دستی ورود"} />
      </form>
    </div>
  );
}
