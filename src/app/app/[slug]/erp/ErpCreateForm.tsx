"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createErpRecordAction, type ErpFormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "در حال ثبت در Odoo…" : "ثبت در Odoo"}
    </button>
  );
}

/** New partner or product, created in Odoo for this company. Closed until asked for. */
export function ErpCreateForm({ slug, kind }: { slug: string; kind: "partners" | "products" }) {
  const [open, setOpen] = useState(false);
  // One key per record being entered: a double submit is one create.
  const [firstKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  const [state, action] = useFormState<ErpFormState, FormData>(createErpRecordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  if (!open) {
    return (
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
          {kind === "partners" ? "+ طرف‌حساب جدید" : "+ کالا یا خدمت جدید"}
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="card mb-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {kind === "partners" ? "طرف‌حساب جدید" : "کالا یا خدمت جدید"}
        </h3>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700" title="بستن">
          ✕
        </button>
      </div>
      {state.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      {state.ok && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{state.ok}</div>}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={state.key ?? firstKey} />
      {kind === "partners" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">نام شخص یا شرکت</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="label">شناسه مالیاتی / ملی</label>
            <input name="vat" className="input" dir="ltr" />
          </div>
          <div>
            <label className="label">ایمیل</label>
            <input name="email" type="email" className="input text-left" dir="ltr" />
          </div>
          <div>
            <label className="label">تلفن</label>
            <input name="phone" className="input" dir="ltr" />
          </div>
          <div>
            <label className="label">شهر</label>
            <input name="city" className="input" />
          </div>
          <input type="hidden" name="countryCode" value="IR" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">نام</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="label">کد</label>
            <input name="code" className="input" dir="ltr" />
          </div>
          <div>
            <label className="label">نوع</label>
            <select name="type" className="input" defaultValue="goods">
              <option value="goods">کالا</option>
              <option value="service">خدمت</option>
            </select>
          </div>
          <div>
            <label className="label">قیمت فروش (ریال)</label>
            <input name="listPrice" type="number" min="0" step="any" className="input" dir="ltr" />
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
