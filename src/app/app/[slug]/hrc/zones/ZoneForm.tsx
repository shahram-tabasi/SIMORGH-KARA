"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ZONE_KINDS } from "@/lib/hrc";
import { createZoneAction, type HrcState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن ناحیه"}
    </button>
  );
}

export function ZoneForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<HrcState, FormData>(createZoneAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن ناحیه به نقشه</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">نام ناحیه</label>
          <input name="name" required className="input" placeholder="سالن تولید ۲" />
        </div>
        <div>
          <label className="label">نوع</label>
          <select name="kind" className="input" defaultValue="area">
            {Object.entries(ZONE_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">رنگ</label>
          <input name="color" type="color" defaultValue="#38bdf8" className="input h-10 p-1" />
        </div>
        <div>
          <label className="label">مختصات</label>
          <select name="coordMode" className="input" defaultValue="geo">
            <option value="geo">جغرافیایی (lat, lng)</option>
            <option value="plan">نسبت به تصویر نقشه (٪)</option>
          </select>
        </div>
        <div className="sm:col-span-4">
          <label className="label">چندضلعی ناحیه (JSON)</label>
          <textarea
            name="polygon"
            rows={3}
            dir="ltr"
            className="input text-left font-mono text-xs"
            placeholder='[[35.7219,51.3347],[35.7225,51.3360],[35.7210,51.3365]]'
          />
          <p className="mt-1 text-[11px] text-slate-400">
            هر نقطه در حالت جغرافیایی [عرض، طول] و در حالت نقشه [x٪، y٪] از گوشهٔ
            بالا-چپ تصویر است. حداقل سه نقطه لازم است.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="alertOnEnter" className="h-4 w-4" />
          هشدار هنگام ورود
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="alertOnExit" className="h-4 w-4" />
          هشدار هنگام خروج
        </label>
        <div className="sm:col-span-2">
          <label className="label">توضیح</label>
          <input name="note" className="input" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
