"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS } from "@/lib/jalali";
import { createTaskAction, type TaskState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ارسال کار"}
    </button>
  );
}

function DateGroup({ prefix, year, label }: { prefix: string; year: number; label: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1">
        <input name={`${prefix}y`} type="number" defaultValue={year} className="input w-20" dir="ltr" />
        <select name={`${prefix}m`} className="input w-24" defaultValue="">
          <option value="">ماه</option>
          {JALALI_MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
        </select>
        <select name={`${prefix}d`} className="input w-16" defaultValue="">
          <option value="">روز</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
      </div>
    </div>
  );
}

export function TaskForm({
  slug,
  year,
  groups,
  members,
}: {
  slug: string;
  year: number;
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const [state, action] = useFormState<TaskState, FormData>(createTaskAction, {});
  const [mode, setMode] = useState<"group" | "members">(groups.length ? "group" : "members");
  const [priority, setPriority] = useState("normal");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) { ref.current?.reset(); setPriority("normal"); } }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">ارسال کار جدید</h3>
      {state.error && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>}
      {state.ok && <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">کار ارسال شد.</div>}
      <input type="hidden" name="slug" value={slug} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">عنوان کار</label>
          <input name="title" className="input" placeholder="مثلاً وایرینگ تابلو" />
        </div>
        <div>
          <label className="label">کد کار (اختیاری)</label>
          <input name="code" className="input" dir="ltr" placeholder="110234" />
        </div>
      </div>

      <div>
        <label className="label">شرح</label>
        <input name="body" className="input" placeholder="توضیح کوتاه" />
      </div>

      <div>
        <label className="label">اولویت</label>
        <div className="flex gap-2">
          {[
            { v: "normal", l: "عادی", c: "border-slate-200 text-slate-600" },
            { v: "urgent", l: "ضروری", c: "border-amber-300 text-amber-700 bg-amber-50" },
            { v: "forced", l: "فوری/اجباری", c: "border-red-300 text-red-700 bg-red-50" },
          ].map((o) => (
            <label key={o.v} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${priority === o.v ? o.c + " ring-2 ring-offset-1 ring-brand-200" : "border-slate-200 text-slate-500"}`}>
              <input type="radio" name="priority" value={o.v} className="hidden" checked={priority === o.v} onChange={() => setPriority(o.v)} />
              {o.l}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateGroup prefix="f" year={year} label="از تاریخ (اختیاری)" />
        <DateGroup prefix="t" year={year} label="سررسید (اختیاری)" />
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
