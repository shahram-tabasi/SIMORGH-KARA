"use client";

import { useFormState, useFormStatus } from "react-dom";
import { forcePasswordChangeAction, type ChangeState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary w-full" disabled={pending}>
      {pending ? "در حال ثبت…" : "ثبت رمز جدید و ادامه"}
    </button>
  );
}

export function ChangeForm({ isDefault }: { isDefault: boolean }) {
  const [state, action] = useFormState<ChangeState, FormData>(
    forcePasswordChangeAction,
    {}
  );

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div>
        <label className="label">رمز عبور فعلی</label>
        <input
          name="currentPassword"
          type="password"
          required
          dir="ltr"
          className="input text-left"
          autoComplete="current-password"
          placeholder={isDefault ? "همان رمزی که با آن وارد شدید" : undefined}
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
        <label className="label">تکرار رمز عبور جدید</label>
        <input
          name="confirmPassword"
          type="password"
          required
          dir="ltr"
          className="input text-left"
          autoComplete="new-password"
        />
      </div>
      <Submit />
    </form>
  );
}
