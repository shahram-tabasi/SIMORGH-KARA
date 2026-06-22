"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "در حال ورود…" : "ورود به سامانه"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-bl from-brand-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">
            س
          </div>
          <h1 className="text-2xl font-bold text-slate-800">سیمرغ لجر</h1>
          <p className="mt-1 text-sm text-slate-500">
            سامانه یکپارچه مدیریت شرکت‌ها
          </p>
        </div>

        <form action={formAction} className="card space-y-4">
          {state.error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              ایمیل
            </label>
            <input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              required
              className="input text-left"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              رمز عبور
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="input"
              placeholder="••••••••"
            />
          </div>
          <SubmitButton />
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          © سیمرغ لجر — تمامی حقوق محفوظ است
        </p>
      </div>
    </main>
  );
}
