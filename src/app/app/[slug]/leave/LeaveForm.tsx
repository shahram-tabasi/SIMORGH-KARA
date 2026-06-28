"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JALALI_MONTHS } from "@/lib/jalali";
import { submitLeaveAction, type LeaveState } from "./actions";

export interface LeaveTypeOption {
  id: string;
  code: string;
  name: string;
  unit: "day" | "hour";
  requires_attachment: boolean;
  description: string | null;
}

const MISSION_SUBTYPES = [
  "برون‌شهری روزانه",
  "برون‌شهری چندروزه",
  "درون‌شهری",
  "خارج از کشور",
];
const TRANSPORTS = [
  "خودرو شخصی",
  "خودرو سازمانی",
  "هواپیما",
  "قطار",
  "اتوبوس",
  "سایر",
];

/** Detailed mission fields — only shown when the selected type is a mission. */
function MissionFields() {
  return (
    <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/60 p-3 dark:border-purple-500/30 dark:bg-purple-500/[0.06]">
      <div className="text-xs font-semibold text-purple-700 dark:text-purple-300">
        🧳 جزئیات مأموریت
      </div>

      <div>
        <label className="label">نوع مأموریت</label>
        <select name="m_subtype" className="input" defaultValue={MISSION_SUBTYPES[0]}>
          {MISSION_SUBTYPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">شهر مبدأ *</label>
          <input name="m_origin" className="input" placeholder="مثلاً تهران" />
        </div>
        <div>
          <label className="label">شهر مقصد *</label>
          <input name="m_destination" className="input" placeholder="مثلاً اصفهان" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">وسیله رفت</label>
          <select name="m_transport_go" className="input" defaultValue={TRANSPORTS[0]}>
            {TRANSPORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">وسیله برگشت</label>
          <select name="m_transport_back" className="input" defaultValue={TRANSPORTS[0]}>
            {TRANSPORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">ساعت شروع</label>
          <input name="m_start_time" type="time" className="input" dir="ltr" />
        </div>
        <div>
          <label className="label">ساعت خاتمه</label>
          <input name="m_end_time" type="time" className="input" dir="ltr" />
        </div>
      </div>

      <div>
        <label className="label">موضوع مأموریت</label>
        <input name="m_subject" className="input" placeholder="موضوع و هدف مأموریت" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">نام پروژه</label>
          <input name="m_project" className="input" placeholder="نام پروژه" />
        </div>
        <div>
          <label className="label">شمارهٔ شناسایی (OE)</label>
          <input name="m_oe" className="input" dir="ltr" placeholder="OE" />
        </div>
      </div>

      <div>
        <label className="label">محل مراجعه</label>
        <input name="m_visit_place" className="input" placeholder="نام شرکت / محل مراجعه" />
      </div>

      <div>
        <label className="label">پرسنل جایگزین</label>
        <input name="m_substitute" className="input" placeholder="نام همکار جایگزین (اختیاری)" />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input name="m_client_request" type="checkbox" className="h-4 w-4 rounded border-slate-300" />
        درخواست از طرف مشتری
      </label>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : "ثبت درخواست"}
    </button>
  );
}

function DateGroup({
  prefix,
  year,
  def,
}: {
  prefix: string;
  year: number;
  def?: { y: number; m: number; d: number };
}) {
  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="label">سال</label>
        <input name={`${prefix}y`} type="number" defaultValue={def?.y ?? year} className="input w-24" dir="ltr" />
      </div>
      <div>
        <label className="label">ماه</label>
        <select name={`${prefix}m`} className="input w-28" defaultValue={String(def?.m ?? 1)}>
          {JALALI_MONTHS.map((mn, i) => (
            <option key={i} value={i + 1}>{mn}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">روز</label>
        <select name={`${prefix}d`} className="input w-20" defaultValue={String(def?.d ?? 1)}>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export interface LeavePrefill {
  from?: { y: number; m: number; d: number };
  to?: { y: number; m: number; d: number };
  typeId?: string;
}

export function LeaveForm({
  slug,
  year,
  types,
  prefill,
}: {
  slug: string;
  year: number;
  types: LeaveTypeOption[];
  prefill?: LeavePrefill;
}) {
  const [state, action] = useFormState<LeaveState, FormData>(
    submitLeaveAction,
    {}
  );
  const [typeId, setTypeId] = useState(prefill?.typeId ?? types[0]?.id ?? "");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setTypeId(types[0]?.id ?? "");
    }
  }, [state.ok, types]);

  const selected = types.find((t) => t.id === typeId);
  const hourly = selected?.unit === "hour";
  const isMission = selected?.code === "mission";

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
        <DateGroup prefix="f" year={year} def={prefill?.from} />
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
          <DateGroup prefix="t" year={year} def={prefill?.to} />
        </div>
      )}

      {isMission && <MissionFields />}

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
