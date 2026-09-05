"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PERMISSIONS, permissionGroups } from "@/lib/rbac";
import { createApiKeyAction, type ApiKeyState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ساخت…" : "ساخت کلید API"}
    </button>
  );
}

export function ApiKeyForm({
  slug,
  modules,
}: {
  slug: string;
  modules: readonly string[];
}) {
  const [state, action] = useFormState<ApiKeyState, FormData>(
    createApiKeyAction,
    {}
  );
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && state.token) {
      setToken(state.token);
      ref.current?.reset();
    }
  }, [state.ok, state.token]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">ساخت کلید API</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      {token && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          کلید ساخته شد — این متن فقط همین یک بار نمایش داده می‌شود؛ آن را در
          نرم‌افزار مقصد ذخیره کنید:
          <code className="mt-1 block break-all text-xs" dir="ltr">
            {token}
          </code>
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">نام کلید</label>
          <input name="name" required className="input" placeholder="مثلاً سامانهٔ فروش" />
        </div>
        <div>
          <label className="label">انقضا (روز)</label>
          <input
            name="expiresDays"
            type="number"
            min={0}
            defaultValue={0}
            dir="ltr"
            className="input text-left"
            placeholder="۰ = بدون انقضا"
          />
        </div>
      </div>

      <div>
        <label className="label">دسترسی‌های کلید (scopes)</label>
        <div className="space-y-3">
          {permissionGroups(modules).map((g) => (
            <div key={g.module}>
              <div className="mb-1.5 text-xs font-semibold text-slate-500">
                {g.icon} {g.title}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {g.keys.map((k) => (
                  <label
                    key={k}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600"
                  >
                    <input type="checkbox" name="scopes" value={k} />
                    {PERMISSIONS[k]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
