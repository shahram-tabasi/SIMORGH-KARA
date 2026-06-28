"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-brand-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:shadow-brand-600/40 disabled:opacity-60"
    >
      <span>↩</span>
      {pending ? "در حال ورود…" : "ورود به سامانه"}
    </button>
  );
}

const FEATURES = [
  "حضور و غیاب با دستگاه و تشخیص چهره",
  "گردش‌کار مرخصی و کارتابل",
  "تقویم کاری و میز کار تیمی",
  "گزارش‌های تحلیلی و داشبورد مدیریتی",
];

export default function LoginPage() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);

  return (
    <main className="flex min-h-screen bg-slate-50">
      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt="سیمرغ‌کارا"
              className="mb-4 h-28 w-28 rounded-3xl object-cover shadow-xl shadow-brand-900/20 ring-1 ring-slate-200"
            />
            <h1 className="text-2xl font-extrabold text-slate-800">سیمرغ‌کارا</h1>
            <p className="mt-1 text-sm text-slate-500">
              سامانهٔ هوشمند حضور و غیاب و مدیریت سازمان
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-xl shadow-slate-200/60 ring-1 ring-slate-100">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-800">👋 خوش آمدید</h2>
              <p className="mt-1 text-xs text-slate-500">
                برای ورود، ایمیل و رمز عبور خود را وارد کنید.
              </p>
            </div>

            <form action={formAction} className="space-y-4">
              {state.error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {state.error}
                </div>
              )}
              <div>
                <label className="label" htmlFor="email">ایمیل</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">✉</span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    dir="ltr"
                    required
                    autoComplete="email"
                    className="input pr-9 text-left"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="password">رمز عبور</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔒</span>
                  <input
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="input px-9"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="نمایش رمز"
                  >
                    {show ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <SubmitButton />
            </form>

            <p className="mt-5 text-center text-xs text-slate-400">
              🛡 ورود امن — اطلاعات شما رمزنگاری می‌شود
            </p>
          </div>
        </div>
      </div>

      {/* Brand panel */}
      <aside className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-800 lg:block">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center justify-end gap-3">
            <div className="text-xl font-bold">سیمرغ‌کارا</div>
            <img src="/logo.png" alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/20" />
          </div>
          <div>
            <h2 className="text-4xl font-extrabold leading-snug">
              سامانهٔ یکپارچهٔ
              <br />
              مدیریت سازمان
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
              منابع انسانی، حضور و غیاب هوشمند، کارتابل و میز کار، مرخصی و
              حسابداری — همه در یک پلتفرم چندشرکتی.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-white/90">
              {FEATURES.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <span>🛡</span> سیمرغ‌کارا — تمامی حقوق محفوظ است
          </div>
        </div>
      </aside>
    </main>
  );
}
