"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JalaliDateFields } from "@/components/JalaliDate";
import { createFiscalYearAction, type FinanceState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن سال مالی"}
    </button>
  );
}

export function FiscalYearForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<FinanceState, FormData>(
    createFiscalYearAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن سال مالی</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">عنوان</label>
          <input name="title" required className="input" placeholder="سال مالی ۱۴۰۵" />
        </div>
        <JalaliDateFields prefix="start" label="از تاریخ" />
        <JalaliDateFields prefix="end" label="تا تاریخ" />
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
