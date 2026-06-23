"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { assignTaskAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ارجاع کار"}
    </button>
  );
}

export function AssignTaskForm({
  slug,
  members,
}: {
  slug: string;
  members: { id: string; name: string }[];
}) {
  const [state, action] = useFormState<ActionState, FormData>(
    assignTaskAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">
        ارجاع کار به یک عضو
      </h3>
      <p className="text-xs text-slate-400">
        کاری که ارجاع می‌دهید در کارتابل آن فرد قرار می‌گیرد و فقط شما (ارجاع‌کننده)
        می‌توانید آن را ویرایش یا حذف کنید؛ گیرنده تنها وضعیت پیشرفت را تغییر می‌دهد.
      </p>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
          کار با موفقیت ارجاع شد.
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">عضو مقصد</label>
          <select name="memberId" required className="input w-48">
            <option value="">— انتخاب —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">عنوان کار</label>
          <input name="title" required className="input" />
        </div>
        <select name="kind" className="input w-28">
          <option value="task">وظیفه</option>
          <option value="document">سند</option>
          <option value="message">پیام</option>
        </select>
        <Submit />
      </div>
      <textarea name="body" rows={2} className="input" placeholder="توضیحات (اختیاری)" />
    </form>
  );
}
