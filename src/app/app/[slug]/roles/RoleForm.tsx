"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PERMISSIONS } from "@/lib/rbac";
import { createRoleAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "ساخت نقش"}
    </button>
  );
}

export function RoleForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<ActionState, FormData>(
    createRoleAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">ساخت نقش جدید</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">نام نقش</label>
          <input name="name" required className="input" placeholder="مثلاً حسابدار" />
        </div>
        <div>
          <label className="label">توضیح</label>
          <input name="description" className="input" />
        </div>
      </div>
      <div>
        <label className="label">مجوزها</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(PERMISSIONS).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600"
            >
              <input type="checkbox" name="permissions" value={key} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
