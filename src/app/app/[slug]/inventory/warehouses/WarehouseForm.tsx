"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createWarehouseAction, type InventoryState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن انبار"}
    </button>
  );
}

export function WarehouseForm({
  slug,
  members,
}: {
  slug: string;
  members: { id: string; full_name: string }[];
}) {
  const [state, action] = useFormState<InventoryState, FormData>(
    createWarehouseAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن انبار</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">کد</label>
          <input name="code" required dir="ltr" className="input text-left" placeholder="W2" />
        </div>
        <div>
          <label className="label">نام انبار</label>
          <input name="name" required className="input" placeholder="انبار قطعات" />
        </div>
        <div>
          <label className="label">موقعیت</label>
          <input name="location" className="input" placeholder="سالن ۲" />
        </div>
        <div>
          <label className="label">انباردار</label>
          <select name="managerId" className="input" defaultValue="">
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
