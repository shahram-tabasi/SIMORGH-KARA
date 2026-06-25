"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { sendMessageAction, type TaskState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ارسال پیام"}
    </button>
  );
}

export function MessageForm({
  slug,
  groups,
  members,
}: {
  slug: string;
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const [state, action] = useFormState<TaskState, FormData>(sendMessageAction, {});
  const [mode, setMode] = useState<"group" | "members">(groups.length ? "group" : "members");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">پیام به زیرگروه</h3>
      <p className="-mt-1 text-xs text-slate-400">
        ارسال پیام (نه وظیفه) — در کارتابل گیرندگان می‌نشیند.
      </p>
      {state.error && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>}
      {state.ok && <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">پیام ارسال شد.</div>}
      <input type="hidden" name="slug" value={slug} />

      <div>
        <label className="label">متن پیام</label>
        <input name="title" className="input" placeholder="مثلاً جلسهٔ ایمنی ساعت ۱۰ برگزار می‌شود" />
      </div>
      <div>
        <label className="label">توضیح بیشتر (اختیاری)</label>
        <input name="body" className="input" placeholder="جزئیات…" />
      </div>

      <div>
        <label className="label">گیرنده</label>
        <div className="mb-2 flex gap-2">
          <button type="button" onClick={() => setMode("group")} className={`rounded-md border px-3 py-1.5 text-sm ${mode === "group" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>زیرگروه (گروهی)</button>
          <button type="button" onClick={() => setMode("members")} className={`rounded-md border px-3 py-1.5 text-sm ${mode === "members" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>افراد (تک‌به‌تک)</button>
        </div>
        <input type="hidden" name="mode" value={mode} />
        {mode === "group" ? (
          <select name="groupId" className="input" defaultValue="">
            <option value="">یک زیرگروه را انتخاب کنید…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-100 p-2 sm:grid-cols-3">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" name="memberIds" value={m.id} />
                {m.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end"><Submit /></div>
    </form>
  );
}
