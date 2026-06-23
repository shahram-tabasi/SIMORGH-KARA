"use client";

import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveLeaveTypeAction, type TypeState } from "./actions";

export interface LeaveTypeData {
  id: string;
  name: string;
  unit: "day" | "hour";
  paid: boolean;
  deducts_entitlement: boolean;
  counts_inner_holidays: boolean;
  requires_attachment: boolean;
  max_minutes_per_day: number | null;
  max_count_per_month: number | null;
  max_count_per_week: number | null;
  max_days_per_year: number | null;
  approval_levels: number;
  is_active: boolean;
  sort_order: number;
  description: string | null;
}

function Submit({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : edit ? "ذخیره تغییرات" : "افزودن نوع مرخصی"}
    </button>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

function NumField({
  name,
  label,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: number | null | undefined;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        name={name}
        type="number"
        step="any"
        defaultValue={defaultValue ?? ""}
        className="input"
        dir="ltr"
        placeholder="—"
      />
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export function LeaveTypeForm({
  slug,
  initial,
  onDone,
}: {
  slug: string;
  initial?: LeaveTypeData;
  onDone?: () => void;
}) {
  const [state, action] = useFormState<TypeState, FormData>(
    saveLeaveTypeAction,
    {}
  );
  const edit = !!initial;

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">نام نوع مرخصی</label>
          <input
            name="name"
            defaultValue={initial?.name}
            className="input"
            placeholder="مثلاً مرخصی استحقاقی روزانه"
          />
        </div>
        <div>
          <label className="label">واحد</label>
          <select name="unit" defaultValue={initial?.unit ?? "day"} className="input">
            <option value="day">روزانه</option>
            <option value="hour">ساعتی</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Check name="paid" label="با حقوق" defaultChecked={initial ? initial.paid : true} />
        <Check
          name="deducts_entitlement"
          label="کسر از استحقاقی"
          defaultChecked={initial ? initial.deducts_entitlement : true}
        />
        <Check
          name="counts_inner_holidays"
          label="احتساب تعطیلات داخل بازه"
          defaultChecked={initial?.counts_inner_holidays}
        />
        <Check
          name="requires_attachment"
          label="نیاز به مدرک"
          defaultChecked={initial?.requires_attachment}
        />
        <Check
          name="is_active"
          label="فعال"
          defaultChecked={initial ? initial.is_active : true}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumField
          name="max_minutes_per_day"
          label="سقف دقیقه در روز"
          defaultValue={initial?.max_minutes_per_day}
          hint="مثلاً ۲۴۰ برای ساعتی"
        />
        <NumField
          name="max_count_per_month"
          label="سقف نوبت در ماه"
          defaultValue={initial?.max_count_per_month}
          hint="مثلاً ۵ برای ساعتی"
        />
        <NumField
          name="max_count_per_week"
          label="سقف نوبت در هفته"
          defaultValue={initial?.max_count_per_week}
          hint="مثلاً ۲ برای مجوز خروج"
        />
        <NumField
          name="max_days_per_year"
          label="سقف روز در سال"
          defaultValue={initial?.max_days_per_year}
          hint="مثلاً ۳۰ یا ۳"
        />
        <NumField
          name="approval_levels"
          label="تعداد مراحل تأیید"
          defaultValue={initial?.approval_levels ?? 1}
        />
        <NumField
          name="sort_order"
          label="ترتیب نمایش"
          defaultValue={initial?.sort_order ?? 100}
        />
      </div>

      <div>
        <label className="label">توضیح</label>
        <input
          name="description"
          defaultValue={initial?.description ?? ""}
          className="input"
          placeholder="مرجع قانونی یا توضیح کوتاه"
        />
      </div>

      <div className="flex items-center gap-2">
        <Submit edit={edit} />
        {edit && onDone && (
          <button type="button" onClick={onDone} className="btn-ghost">
            انصراف
          </button>
        )}
      </div>
    </form>
  );
}
