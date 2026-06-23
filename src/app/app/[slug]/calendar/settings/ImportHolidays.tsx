"use client";

import { useFormState, useFormStatus } from "react-dom";
import { importOfficialHolidaysAction } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال افزودن…" : "افزودن تعطیلات رسمی"}
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
      <h3 className="text-sm font-semibold text-slate-700">
        تعطیلات رسمی ایران
      </h3>
      <p className="text-xs text-slate-500">
        افزودن خودکار تعطیلات رسمی یک سال (نوروز، اعیاد و مناسبت‌های مذهبی).
        تعطیلات مذهبی بر پایهٔ تقویم قمری محاسبه می‌شوند و ممکن است یک روز با
        تقویم رسمی اختلاف داشته باشند؛ در صورت نیاز قابل ویرایش‌اند.
      </p>
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
          تعطیلات رسمی اضافه شد.
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
