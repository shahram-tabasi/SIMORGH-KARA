"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { AccountState } from "@/components/AccountEditor";
import {
  updateHoldingProfileAction,
  changeHoldingPasswordAction,
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

export function HoldingProfileForm({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const [state, action] = useFormState<AccountState, FormData>(
    updateHoldingProfileAction,
    {}
  );
  return (
    <form action={action} className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">ایمیل و نام حساب</h3>
        <p className="mt-1 text-xs text-slate-400">
          با تغییر ایمیل، دفعهٔ بعد باید با ایمیل جدید وارد شوید.
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

export function HoldingPasswordForm() {
  const [state, action] = useFormState<AccountState, FormData>(
    changeHoldingPasswordAction,
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
          اگر هنوز با رمز پیش‌فرض وارد می‌شوید، همین حالا تغییرش دهید.
        </p>
      </div>
      <Banner state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">رمز عبور فعلی</label>
          <input name="currentPassword" type="password" required dir="ltr" className="input text-left" autoComplete="current-password" />
        </div>
        <div>
          <label className="label">رمز عبور جدید</label>
          <input name="newPassword" type="password" required dir="ltr" className="input text-left" autoComplete="new-password" />
        </div>
        <div>
          <label className="label">تکرار رمز جدید</label>
          <input name="confirmPassword" type="password" required dir="ltr" className="input text-left" autoComplete="new-password" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit label="تغییر رمز عبور" busy="در حال تغییر…" />
      </div>
    </form>
  );
}
