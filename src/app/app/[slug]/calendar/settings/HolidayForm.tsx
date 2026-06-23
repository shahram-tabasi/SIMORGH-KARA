"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS } from "@/lib/jalali";
import { addHolidayAction, type CalState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ثبت تعطیلی"}
    </button>
  );
}

export function HolidayForm({
  slug,
  defaultYear,
}: {
  slug: string;
  defaultYear: number;
}) {
  const [state, action] = useFormState<CalState, FormData>(
    addHolidayAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">افزودن تعطیلی شرکت</h3>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
          تعطیلی ثبت شد.
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">سال</label>
          <input
            name="jy"
            type="number"
            defaultValue={defaultYear}
            className="input w-24"
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">ماه</label>
          <select name="jm" className="input w-28" defaultValue="1">
            {JALALI_MONTHS.map((mn, i) => (
              <option key={i} value={i + 1}>
                {mn}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">روز</label>
          <select name="jd" className="input w-20" defaultValue="1">
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">عنوان مناسبت</label>
          <input name="title" required className="input" placeholder="مثلاً تعطیلی شرکت" />
        </div>
        <Submit />
      </div>
    </form>
  );
}
