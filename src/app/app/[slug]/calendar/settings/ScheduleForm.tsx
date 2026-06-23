"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { WEEKDAYS } from "@/lib/jalali";
import { saveScheduleAction, type CalState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "افزودن شیفت"}
    </button>
  );
}

export function ScheduleForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<CalState, FormData>(
    saveScheduleAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">تعریف شیفت کاری</h3>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className="label">نام شیفت</label>
          <input name="name" required className="input" placeholder="مثلاً شیفت اداری" />
        </div>
        <div>
          <label className="label">ساعت شروع</label>
          <input name="start_time" type="time" defaultValue="08:00" className="input" dir="ltr" />
        </div>
        <div>
          <label className="label">ساعت پایان</label>
          <input name="end_time" type="time" defaultValue="17:00" className="input" dir="ltr" />
        </div>
      </div>
      <div>
        <label className="label">روزهای کاری</label>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((w, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                name="work_days"
                value={i}
                defaultChecked={i <= 4}
              />
              {w}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
