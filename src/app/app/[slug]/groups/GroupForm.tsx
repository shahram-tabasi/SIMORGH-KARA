"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createGroupAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "افزودن زیرگروه"}
    </button>
  );
}

export function GroupForm({
  slug,
  groups,
}: {
  slug: string;
  groups: { id: string; label: string }[];
}) {
  const [state, action] = useFormState<ActionState, FormData>(
    createGroupAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card flex flex-wrap items-end gap-3">
      {state.error && (
        <div className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="flex-1">
        <label className="label">نام زیرگروه</label>
        <input name="name" required className="input" placeholder="مثلاً واحد فروش" />
      </div>
      <div>
        <label className="label">زیرمجموعهٔ</label>
        <select name="parentId" className="input">
          <option value="">— سطح بالا —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <Submit />
    </form>
  );
}
