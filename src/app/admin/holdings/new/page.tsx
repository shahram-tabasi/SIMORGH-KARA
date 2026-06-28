"use client";

import { useFormState, useFormStatus } from "react-dom";
import { PageHeader } from "@/components/Shell";
import { createHoldingAction, type CompanyFormState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ساخت…" : "ساخت هولدینگ و مدیر آن"}
    </button>
  );
}

export default function NewHoldingPage() {
  const [state, action] = useFormState<CompanyFormState, FormData>(
    createHoldingAction,
    {}
  );

  return (
    <>
      <PageHeader
        title="افزودن هولدینگ جدید"
        description="یک هولدینگ و حساب «مدیر هولدینگ» ساخته می‌شود؛ مدیر هولدینگ تا سقف تعیین‌شده می‌تواند شرکت بسازد و مدیر هر شرکت را تعیین کند"
      />

      <form action={action} className="card max-w-2xl space-y-5">
        {state.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">نام هولدینگ</label>
            <input name="name" required className="input" placeholder="مثلاً هولدینگ صنعتی نمونه" />
          </div>
          <div>
            <label className="label">سقف تعداد شرکت</label>
            <input name="maxCompanies" type="number" min={1} defaultValue={1} dir="ltr" className="input" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">مدیر هولدینگ</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">نام و نام خانوادگی</label>
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
