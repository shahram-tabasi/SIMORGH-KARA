"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ACCOUNT_TYPES } from "@/lib/finance";
import { createAccountAction, type FinanceState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن حساب"}
    </button>
  );
}

export function AccountForm({
  slug,
  parents,
}: {
  slug: string;
  parents: { id: string; code: string; name: string }[];
}) {
  const [state, action] = useFormState<FinanceState, FormData>(
    createAccountAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن سرفصل حساب</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">کد حساب</label>
          <input name="code" required dir="ltr" className="input text-left" placeholder="1071" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نام حساب</label>
          <input name="name" required className="input" placeholder="بانک ملت — جاری ۱۲۳" />
        </div>
        <div>
          <label className="label">ماهیت</label>
          <select name="type" className="input" defaultValue="asset">
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className="label">زیرمجموعهٔ حساب</label>
          <select name="parentId" className="input" defaultValue="">
            <option value="">— بدون والد (حساب کل) —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="isGroup" className="h-4 w-4" />
          حساب گروهی (سند نمی‌پذیرد)
        </label>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
