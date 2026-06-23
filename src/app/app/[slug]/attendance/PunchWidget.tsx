"use client";

import { useFormStatus } from "react-dom";
import { punchAction } from "./actions";
import { formatTime, formatDuration } from "@/lib/attendance";

function ToggleButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary px-6 py-3 text-base" disabled={pending}>
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
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">وضعیت امروز شما</div>
          <div className="mt-1 flex items-center gap-3">
            <span
              className={`badge ${
                state === "in"
                  ? "bg-green-100 text-green-700"
                  : state === "done"
                    ? "bg-slate-200 text-slate-600"
                    : "bg-amber-100 text-amber-700"
              }`}
            >
              {state === "in"
                ? "در حال کار"
                : state === "done"
                  ? "خارج شده"
                  : "هنوز وارد نشده‌اید"}
            </span>
            <span className="text-sm text-slate-500">
              کارکرد امروز: {formatDuration(workedMinutes)}
            </span>
          </div>
        </div>

        <form action={punchAction}>
          <input type="hidden" name="slug" value={slug} />
          <ToggleButton label={working ? "ثبت خروج" : "ثبت ورود"} />
        </form>
      </div>

      {punches.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {punches.map((p, i) => (
            <span
              key={i}
              className={`badge ${
                p.kind === "in"
                  ? "bg-green-50 text-green-700"
                  : "bg-rose-50 text-rose-700"
              }`}
              dir="ltr"
            >
              {p.kind === "in" ? "↳ ورود" : "↰ خروج"} {formatTime(new Date(p.at))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
