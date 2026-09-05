"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateOwnProfileAction,
  changeOwnPasswordAction,
  type AccountState,
} from "../actions";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

function Banner({ state }: { state: AccountState }) {
  if (state.error) {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </div>
    );
  }
  if (state.ok) {
    return (
      <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        {state.ok}
      </div>
    );
  }
  return null;
}

/** ایمیل و نام حساب مدیر سیمرغ (همان ایمیلی که با آن وارد می‌شوید). */
export function ProfileForm({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const [state, action] = useFormState<AccountState, FormData>(
    updateOwnProfileAction,
    {}
  );

  return (
    <form action={action} className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">ایمیل و نام حساب</h3>
        <p className="mt-1 text-xs text-slate-400">
          ایمیل همان چیزی است که در صفحهٔ ورود وارد می‌کنید؛ با تغییر آن، دفعهٔ
          بعد باید با ایمیل جدید وارد شوید.
        </p>
      </div>
      <Banner state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">نام و نام خانوادگی</label>
          <input name="fullName" defaultValue={fullName} required className="input" />
        </div>
        <div>
          <label className="label">ایمیل ورود</label>
          <input
            name="email"
            type="email"
            dir="ltr"
            defaultValue={email}
            required
            className="input text-left"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit label="ذخیرهٔ تغییرات" busy="در حال ذخیره…" />
      </div>
    </form>
  );
}

/** تغییر رمز عبور خودِ مدیر — با تأیید رمز فعلی. */
export function PasswordForm() {
  const [state, action] = useFormState<AccountState, FormData>(
    changeOwnPasswordAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">تغییر رمز عبور</h3>
        <p className="mt-1 text-xs text-slate-400">
          برای تغییر رمز، ابتدا رمز فعلی را وارد کنید. رمز جدید حداقل ۸ نویسه
          باشد.
        </p>
      </div>
      <Banner state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">رمز عبور فعلی</label>
          <input
            name="currentPassword"
            type="password"
            required
            dir="ltr"
            className="input text-left"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">رمز عبور جدید</label>
          <input
            name="newPassword"
            type="password"
            required
            dir="ltr"
            className="input text-left"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">تکرار رمز جدید</label>
          <input
            name="confirmPassword"
            type="password"
            required
            dir="ltr"
            className="input text-left"
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit label="تغییر رمز عبور" busy="در حال تغییر…" />
      </div>
    </form>
  );
}
