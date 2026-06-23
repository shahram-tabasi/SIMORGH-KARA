"use client";

import { useFormState, useFormStatus } from "react-dom";
import { importOfficialHolidaysAction } from "../actions";
import { toFaDigits } from "@/lib/jalali";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال همگام‌سازی…" : "همگام‌سازی آنلاین"}
    </button>
  );
}

export function ImportHolidays({
  slug,
  defaultYear,
}: {
  slug: string;
  defaultYear: number;
}) {
  const [state, action] = useFormState(importOfficialHolidaysAction, {});
  return (
    <form action={action} className="card space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          تعطیلات رسمی ایران
        </h3>
        <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          منبع آنلاین
        </span>
      </div>
      <p className="text-xs text-slate-500">
        تعطیلات و مناسبت‌های رسمی یک سال (نوروز، اعیاد و مناسبت‌های مذهبی) به‌صورت
        آنلاین از تقویم به‌روز خوانده و درج می‌شوند. اگر اینترنت در دسترس نباشد،
        به‌صورت خودکار از محاسبهٔ آفلاین (تقویم قمری جدولی) استفاده می‌شود و
        تاریخ‌ها قابل ویرایش‌اند.
      </p>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
          {toFaDigits(state.count ?? 0)} تعطیلی درج/به‌روزرسانی شد
          {state.source === "online"
            ? " (از منبع آنلاین)"
            : " (آفلاین — اینترنت در دسترس نبود)"}
          .
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="flex items-end gap-2">
        <div>
          <label className="label">سال شمسی</label>
          <input
            name="jy"
            type="number"
            defaultValue={defaultYear}
            className="input w-28"
            dir="ltr"
          />
        </div>
        <Submit />
      </div>
    </form>
  );
}
