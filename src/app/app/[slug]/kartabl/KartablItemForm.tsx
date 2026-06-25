"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS, todayJalali } from "@/lib/jalali";
import { addKartablItemAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "افزودن"}
    </button>
  );
}

export function KartablItemForm({
  slug,
  kartablId,
}: {
  slug: string;
  kartablId: string;
}) {
  const [state, action] = useFormState<ActionState, FormData>(
    addKartablItemAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  const [remind, setRemind] = useState(false);
  const ty = todayJalali().jy;
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setRemind(false);
    }
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg bg-slate-50 p-3">
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="kartablId" value={kartablId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <input name="title" required className="input" placeholder="عنوان کار / سند…" />
        </div>
        <select name="kind" className="input w-32">
          <option value="task">یادداشت</option>
          <option value="document">سند</option>
          <option value="message">پیام</option>
        </select>
        <Submit />
      </div>
      <textarea name="body" rows={2} className="input" placeholder="توضیحات (اختیاری)" />

      <div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={remind}
            onChange={(e) => setRemind(e.target.checked)}
          />
          ⏰ یادآوری + افزودن به تقویم
        </label>
        {remind && (
          <div className="mt-2 flex flex-wrap items-end gap-1.5">
            <input name="ry" type="number" defaultValue={ty} className="input w-20" dir="ltr" />
            <select name="rm" className="input w-24" defaultValue={String(todayJalali().jm)}>
              {JALALI_MONTHS.map((mn, i) => (
                <option key={i} value={i + 1}>{mn}</option>
              ))}
            </select>
            <select name="rd" className="input w-16" defaultValue={String(todayJalali().jd)}>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <input name="rtime" type="time" defaultValue="09:00" className="input w-28" dir="ltr" />
          </div>
        )}
      </div>
    </form>
  );
}
