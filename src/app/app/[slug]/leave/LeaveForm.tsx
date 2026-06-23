"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS } from "@/lib/jalali";
import { submitLeaveAction, type LeaveState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ثبت درخواست"}
    </button>
  );
}

function DateGroup({ prefix, year }: { prefix: string; year: number }) {
  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="label">سال</label>
        <input name={`${prefix}y`} type="number" defaultValue={year} className="input w-24" dir="ltr" />
      </div>
      <div>
        <label className="label">ماه</label>
        <select name={`${prefix}m`} className="input w-28" defaultValue="1">
          {JALALI_MONTHS.map((mn, i) => (
            <option key={i} value={i + 1}>{mn}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">روز</label>
        <select name={`${prefix}d`} className="input w-20" defaultValue="1">
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function LeaveForm({ slug, year }: { slug: string; year: number }) {
  const [state, action] = useFormState<LeaveState, FormData>(
    submitLeaveAction,
    {}
  );
  const [kind, setKind] = useState("leave");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">درخواست جدید</h3>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>
      )}
      {state.ok && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
          درخواست شما ثبت شد و در انتظار تأیید است.
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />

      <div>
        <label className="label">نوع</label>
        <div className="flex gap-2">
          {[
            { v: "leave", l: "مرخصی روزانه" },
            { v: "mission", l: "مأموریت" },
            { v: "hourly", l: "مرخصی ساعتی" },
          ].map((o) => (
            <label
              key={o.v}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                kind === o.v
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-600"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={o.v}
                className="hidden"
                checked={kind === o.v}
                onChange={() => setKind(o.v)}
              />
              {o.l}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">{kind === "hourly" ? "تاریخ" : "از تاریخ"}</label>
        <DateGroup prefix="f" year={year} />
      </div>

      {kind === "hourly" ? (
        <div className="flex items-end gap-2">
          <div>
            <label className="label">از ساعت</label>
            <input name="from_time" type="time" className="input" dir="ltr" />
          </div>
          <div>
            <label className="label">تا ساعت</label>
            <input name="to_time" type="time" className="input" dir="ltr" />
          </div>
        </div>
      ) : (
        <div>
          <label className="label">تا تاریخ</label>
          <DateGroup prefix="t" year={year} />
        </div>
      )}

      <div>
        <label className="label">توضیح (اختیاری)</label>
        <input name="reason" className="input" placeholder="علت درخواست" />
      </div>

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
