"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { recordReadingAction, type HrcState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-ghost" disabled={pending}>
      {pending ? "در حال ثبت…" : "ثبت قرائت"}
    </button>
  );
}

/**
 * ثبت دستی علائم حیاتی — برای مانور، معاینهٔ درمانگاه یا زمانی که ساعت آفلاین
 * است. همان موتور آستانه‌ها روی این داده هم اجرا می‌شود و در صورت لزوم هشدار
 * می‌سازد.
 */
export function ManualReadingForm({
  slug,
  members,
}: {
  slug: string;
  members: { id: string; full_name: string }[];
}) {
  const [state, action] = useFormState<HrcState, FormData>(recordReadingAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">ثبت دستی علائم حیاتی</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="col-span-2">
          <label className="label">کارمند</label>
          <select name="memberId" required className="input" defaultValue="">
            <option value="">— انتخاب —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">ضربان</label>
          <input name="heartRate" type="number" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">اکسیژن ٪</label>
          <input name="spo2" type="number" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">دما °C</label>
          <input name="bodyTemp" type="number" step="0.1" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">عرض جغرافیایی</label>
          <input name="lat" type="number" step="0.000001" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">طول جغرافیایی</label>
          <input name="lng" type="number" step="0.000001" dir="ltr" className="input text-left" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <select name="motion" className="input !w-40" defaultValue="">
          <option value="">وضعیت حرکت…</option>
          <option value="still">بی‌حرکت</option>
          <option value="walking">در حال راه‌رفتن</option>
          <option value="running">دویدن</option>
          <option value="fall">سقوط</option>
        </select>
        <Submit />
      </div>
    </form>
  );
}
