"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS } from "@/lib/jalali";
import { submitLeaveAction, type LeaveState } from "./actions";

export interface LeaveTypeOption {
  id: string;
  name: string;
  unit: "day" | "hour";
  requires_attachment: boolean;
  description: string | null;
}

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

export function LeaveForm({
  slug,
  year,
  types,
}: {
  slug: string;
  year: number;
  types: LeaveTypeOption[];
}) {
  const [state, action] = useFormState<LeaveState, FormData>(
    submitLeaveAction,
    {}
  );
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setTypeId(types[0]?.id ?? "");
    }
  }, [state.ok, types]);

  const selected = types.find((t) => t.id === typeId);
  const hourly = selected?.unit === "hour";

  if (types.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        هنوز نوع مرخصی فعالی تعریف نشده است.
      </div>
    );
  }

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
        <label className="label">نوع مرخصی</label>
        <select
          name="type_id"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="input"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.unit === "hour" ? "ساعتی" : "روزانه"})
            </option>
          ))}
        </select>
        {selected?.description && (
          <p className="mt-1 text-[11px] text-slate-400">{selected.description}</p>
        )}
      </div>

      <div>
        <label className="label">{hourly ? "تاریخ" : "از تاریخ"}</label>
        <DateGroup prefix="f" year={year} />
      </div>

      {hourly ? (
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

      {selected?.requires_attachment && (
        <div>
          <label className="label">پیوست مدرک (لینک)</label>
          <input
            name="attachment_url"
            className="input"
            dir="ltr"
            placeholder="https://… (گواهی پزشک، سند و…)"
          />
          <p className="mt-0.5 text-[11px] text-amber-600">
            برای این نوع مرخصی، ارائه مدرک الزامی است.
          </p>
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
