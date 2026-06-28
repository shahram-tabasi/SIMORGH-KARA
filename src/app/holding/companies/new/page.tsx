"use client";

import { useFormState, useFormStatus } from "react-dom";
import { PageHeader } from "@/components/Shell";
import { createHoldingCompanyAction, type HoldingFormState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ساخت…" : "ساخت شرکت و مدیر آن"}
    </button>
  );
}

export default function NewSectionPage() {
  const [state, action] = useFormState<HoldingFormState, FormData>(
    createHoldingCompanyAction,
    {}
  );

  return (
    <>
      <PageHeader
        title="افزودن شرکت جدید"
        description="یک شرکت مستقل (با اسکیمای جدا) و مدیر آن ساخته می‌شود؛ مدیر شرکت، گردش‌کار مرخصی و کارکنان خود را اداره می‌کند"
      />

      <form action={action} className="card max-w-2xl space-y-5">
        {state.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">نام شرکت</label>
            <input name="name" required className="input" placeholder="مثلاً شرکت فولاد البرز" />
          </div>
          <div>
            <label className="label">حداکثر تعداد کاربر</label>
            <input type="number" name="maxUsers" defaultValue={25} min={1} className="input" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">مدیر شرکت</h3>
          <p className="mb-3 text-xs text-slate-400">
            این فرد مدیر کامل شرکت است؛ کارکنان را اضافه می‌کند، مرخصی‌ها را در
            کارتابل خود تأیید می‌کند و نقش «کارگزینی» را به فرد مناسب می‌دهد.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">نام و نام خانوادگی مدیر شرکت</label>
              <input name="adminName" required className="input" />
            </div>
            <div>
              <label className="label">ایمیل</label>
              <input name="adminEmail" type="email" dir="ltr" required className="input text-left" />
            </div>
            <div>
              <label className="label">رمز عبور اولیه</label>
              <input name="adminPassword" type="text" required className="input" placeholder="حداقل ۶ کاراکتر" />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Submit />
        </div>
      </form>
    </>
  );
}
