"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { DEVICE_KINDS } from "@/lib/hrc";
import { createDeviceAction, type HrcState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ثبت…" : "ثبت دستگاه"}
    </button>
  );
}

/**
 * ثبت ساعت هوشمند. توکن فقط یک بار پس از ساخت نمایش داده می‌شود و باید در
 * پیکربندی دستگاه قرار بگیرد.
 */
export function DeviceForm({
  slug,
  members,
}: {
  slug: string;
  members: { id: string; full_name: string }[];
}) {
  const [state, action] = useFormState<HrcState, FormData>(createDeviceAction, {});
  const [lastToken, setLastToken] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && state.token) {
      setLastToken(state.token);
      ref.current?.reset();
    }
  }, [state.ok, state.token]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">ثبت ساعت هوشمند</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      {lastToken && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          توکن دستگاه (فقط همین یک بار نمایش داده می‌شود):
          <code className="mt-1 block break-all text-xs" dir="ltr">
            {lastToken}
          </code>
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="label">سریال</label>
          <input name="serial" required dir="ltr" className="input text-left" placeholder="SK-W-001" />
        </div>
        <div>
          <label className="label">مدل</label>
          <input name="model" className="input" placeholder="مثلاً Watch S8" />
        </div>
        <div>
          <label className="label">نوع دستگاه</label>
          <select name="kind" className="input" defaultValue="watch">
            {Object.entries(DEVICE_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">تخصیص به</label>
          <select name="memberId" className="input" defaultValue="">
            <option value="">— بعداً —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
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
