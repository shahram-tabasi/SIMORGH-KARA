"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createDeviceAction, type DeviceState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ساخت دستگاه و توکن"}
    </button>
  );
}

export function DeviceForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<DeviceState, FormData>(createDeviceAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">افزودن دستگاه / اپ</h3>
      {state.error && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>}
      {state.ok && state.token && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          <div className="mb-1 font-semibold">توکن ساخته شد — همین حالا کپی کنید (دوباره نمایش داده نمی‌شود):</div>
          <div className="flex items-center gap-2">
            <code className="block flex-1 overflow-x-auto rounded bg-white px-2 py-1 font-mono text-[11px]" dir="ltr">
              {state.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.token!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-white"
            >
              {copied ? "✓ کپی شد" : "کپی"}
            </button>
          </div>
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="label">نام دستگاه</label>
          <input name="name" className="input" placeholder="مثلاً ترمینال درب اصلی" />
        </div>
        <div>
          <label className="label">نوع</label>
          <select name="kind" className="input w-40" defaultValue="terminal">
            <option value="terminal">ترمینال (چهره/اثرانگشت)</option>
            <option value="guard">اپ نگهبان</option>
            <option value="mobile">اپ موبایل (معدن)</option>
          </select>
        </div>
        <Submit />
      </div>
    </form>
  );
}
