"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { TEAM_KINDS } from "@/lib/hrc";
import { createTeamAction, type HrcState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن تیم"}
    </button>
  );
}

export function TeamForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<HrcState, FormData>(createTeamAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن تیم واکنش</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">نام تیم</label>
          <input name="name" required className="input" placeholder="تیم امداد شیفت شب" />
        </div>
        <div>
          <label className="label">نوع</label>
          <select name="kind" className="input" defaultValue="medical">
            {Object.entries(TEAM_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">تلفن</label>
          <input name="phone" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">کانال بی‌سیم</label>
          <input name="radio" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">محل استقرار</label>
          <input name="base" className="input" placeholder="درمانگاه" />
        </div>
        <div>
          <label className="label">عرض جغرافیایی پایگاه</label>
          <input name="lat" type="number" step="0.000001" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">طول جغرافیایی پایگاه</label>
          <input name="lng" type="number" step="0.000001" dir="ltr" className="input text-left" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
