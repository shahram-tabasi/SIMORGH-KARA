"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { delegateTaskAction, type TaskState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="text-xs text-brand-600 hover:underline disabled:opacity-50" disabled={pending}>
      {pending ? "…" : "واگذاری"}
    </button>
  );
}

export function DelegateControl({
  slug,
  taskId,
  colleagues,
}: {
  slug: string;
  taskId: string;
  colleagues: { id: string; name: string }[];
}) {
  const [state, action] = useFormState<TaskState, FormData>(delegateTaskAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-brand-600 hover:underline"
      >
        واگذاری به هم‌گروه ›
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="taskId" value={taskId} />
      <select name="toMemberId" className="input w-36 text-xs" defaultValue="">
        <option value="">انتخاب فرد…</option>
        {colleagues.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <Submit />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-slate-400 hover:underline"
      >
        انصراف
      </button>
      {state.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}
