"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createManualAlertAction, type HrcState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-ghost" disabled={pending}>
      {pending ? "در حال ثبت…" : "ثبت هشدار"}
    </button>
  );
}

/** ثبت دستی حادثه — وقتی گزارش از طریق بی‌سیم یا تلفن می‌رسد. */
export function ManualAlertForm({
  slug,
  members,
}: {
  slug: string;
  members: { id: string; full_name: string }[];
}) {
  const [state, action] = useFormState<HrcState, FormData>(
    createManualAlertAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card flex flex-wrap items-end gap-3">
      <input type="hidden" name="slug" value={slug} />
      {state.error && (
        <div className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div>
        <label className="label">فرد</label>
        <select name="memberId" className="input !w-44" defaultValue="">
          <option value="">— بدون فرد مشخص —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">شدت</label>
        <select name="severity" className="input !w-28" defaultValue="warn">
          <option value="info">اطلاع</option>
          <option value="warn">هشدار</option>
          <option value="critical">بحرانی</option>
        </select>
      </div>
      <div className="min-w-[14rem] flex-1">
        <label className="label">شرح حادثه</label>
        <input name="message" className="input" placeholder="مثلاً گزارش بی‌سیم از سالن ۲" />
      </div>
      <Submit />
    </form>
  );
}
