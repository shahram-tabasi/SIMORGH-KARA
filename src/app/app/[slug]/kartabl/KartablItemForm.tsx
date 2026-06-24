"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addKartablItemAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "افزودن"}
    </button>
  );
}

export function KartablItemForm({
  slug,
  kartablId,
}: {
  slug: string;
  kartablId: string;
}) {
  const [state, action] = useFormState<ActionState, FormData>(
    addKartablItemAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg bg-slate-50 p-3">
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="kartablId" value={kartablId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <input name="title" required className="input" placeholder="عنوان کار / سند…" />
        </div>
        <select name="kind" className="input w-32">
          <option value="task">یادداشت</option>
          <option value="document">سند</option>
          <option value="message">پیام</option>
        </select>
        <Submit />
      </div>
      <textarea name="body" rows={2} className="input" placeholder="توضیحات (اختیاری)" />
    </form>
  );
}
