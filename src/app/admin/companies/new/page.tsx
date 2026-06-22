"use client";

import { useFormState, useFormStatus } from "react-dom";
import { PageHeader } from "@/components/Shell";
import { createCompanyAction, type CompanyFormState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ساخت…" : "ساخت شرکت و مدیر"}
    </button>
  );
}

export default function NewCompanyPage() {
  const [state, action] = useFormState<CompanyFormState, FormData>(
    createCompanyAction,
    {}
  );

  return (
    <>
      <PageHeader
        title="افزودن شرکت جدید"
        description="یک شرکت (مستأجر) جدید با اسکیمای مستقل و یک حساب مدیر ایجاد می‌شود"
      />

      <form action={action} className="card max-w-2xl space-y-5">
        {state.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            اطلاعات شرکت
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">نام شرکت</label>
              <input name="name" required className="input" placeholder="مثلاً شرکت الکتروکویر" />
            </div>
            <div>
              <label className="label">پلن</label>
              <select name="plan" defaultValue="standard" className="input">
                <option value="trial">آزمایشی</option>
                <option value="standard">استاندارد</option>
                <option value="pro">حرفه‌ای</option>
                <option value="enterprise">سازمانی</option>
              </select>
            </div>
            <div>
              <label className="label">حداکثر تعداد کاربر</label>
              <input
                type="number"
                name="maxUsers"
                defaultValue={10}
                min={1}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            مدیر شرکت (Tenant Admin)
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            این فرد با دسترسی کامل وارد می‌شود و می‌تواند کاربر اضافه کند، نقش و
            سطح دسترسی تعریف کند، زیرگروه بسازد و برای هر نفر کارتابل ایجاد کند.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">نام و نام خانوادگی مدیر</label>
              <input name="adminName" required className="input" />
            </div>
            <div>
              <label className="label">ایمیل مدیر</label>
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
