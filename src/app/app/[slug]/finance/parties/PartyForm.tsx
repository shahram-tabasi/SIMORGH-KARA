"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PARTY_KINDS } from "@/lib/finance";
import {
  createPartyAction,
  createCostCenterAction,
  type FinanceState,
} from "../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : label}
    </button>
  );
}

export function PartyForm({
  slug,
  accounts,
}: {
  slug: string;
  accounts: { id: string; code: string; name: string }[];
}) {
  const [state, action] = useFormState<FinanceState, FormData>(createPartyAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن طرف‌حساب</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">کد</label>
          <input name="code" required dir="ltr" className="input text-left" placeholder="C-101" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نام / عنوان</label>
          <input name="name" required className="input" />
        </div>
        <div>
          <label className="label">نوع</label>
          <select name="kind" className="input" defaultValue="customer">
            {Object.entries(PARTY_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">کد ملی / شناسه</label>
          <input name="nationalId" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">کد اقتصادی</label>
          <input name="economicCode" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">تلفن</label>
          <input name="phone" dir="ltr" className="input text-left" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">حساب معین مرتبط</label>
          <select name="accountId" className="input" defaultValue="">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className="label">نشانی</label>
          <input name="address" className="input" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit label="افزودن طرف‌حساب" />
      </div>
    </form>
  );
}

export function CostCenterForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<FinanceState, FormData>(
    createCostCenterAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن مرکز هزینه</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">کد</label>
          <input name="code" required dir="ltr" className="input text-left" placeholder="CC-10" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نام مرکز هزینه</label>
          <input name="name" required className="input" placeholder="مثلاً خط تولید ۱" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit label="افزودن مرکز هزینه" />
      </div>
    </form>
  );
}
