"use client";

import { useState } from "react";
import { toFaDigits } from "@/lib/jalali";
import { LeaveTypeForm, type LeaveTypeData } from "./LeaveTypeForm";
import { toggleLeaveTypeAction, deleteLeaveTypeAction } from "./actions";

function tag(label: string, on: boolean) {
  return (
    <span
      className={`badge ${on ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300"}`}
    >
      {label}
    </span>
  );
}

export function LeaveTypeCard({
  slug,
  type,
  isSystem,
}: {
  slug: string;
  type: LeaveTypeData;
  isSystem: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="card border-brand-200">
        <LeaveTypeForm
          slug={slug}
          initial={type}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`card ${type.is_active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{type.name}</span>
            <span className="badge bg-brand-50 text-brand-700">
              {type.unit === "hour" ? "ساعتی" : "روزانه"}
            </span>
            {isSystem && (
              <span className="badge bg-slate-200 text-slate-500">پیش‌فرض</span>
            )}
            {!type.is_active && (
              <span className="badge bg-red-50 text-red-500">غیرفعال</span>
            )}
          </div>
          {type.description && (
            <p className="mt-1 text-xs text-slate-500">{type.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setEditing(true)}
            className="text-brand-600 hover:underline"
          >
            ویرایش
          </button>
          <form action={toggleLeaveTypeAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={type.id} />
            <button className="text-slate-500 hover:underline">
              {type.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}
            </button>
          </form>
          {!isSystem && (
            <form action={deleteLeaveTypeAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={type.id} />
              <button className="text-red-600 hover:underline">حذف</button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tag("با حقوق", type.paid)}
        {tag("کسر از استحقاقی", type.deducts_entitlement)}
        {tag("نیاز به مدرک", type.requires_attachment)}
        {tag("احتساب تعطیلات داخل", type.counts_inner_holidays)}
        {type.max_minutes_per_day != null &&
          tag(`سقف ${toFaDigits(type.max_minutes_per_day)} دقیقه/روز`, true)}
        {type.max_count_per_month != null &&
          tag(`${toFaDigits(type.max_count_per_month)} نوبت/ماه`, true)}
        {type.max_count_per_week != null &&
          tag(`${toFaDigits(type.max_count_per_week)} نوبت/هفته`, true)}
        {type.max_days_per_year != null &&
          tag(`${toFaDigits(type.max_days_per_year)} روز/سال`, true)}
        {type.approval_levels > 1 &&
          tag(`${toFaDigits(type.approval_levels)} مرحله تأیید`, true)}
      </div>
    </div>
  );
}
