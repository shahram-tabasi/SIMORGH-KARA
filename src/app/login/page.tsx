"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full overflow-hidden rounded-xl bg-gradient-to-l from-brand-600 to-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:shadow-brand-600/40 disabled:opacity-60"
    >
      {pending ? "در حال ورود…" : "ورود به سامانه"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});

  return (
    <main className="flex min-h-screen bg-slate-50">
      {/* Brand panel */}
      <aside className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-700 lg:block">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold backdrop-blur">
              س
            </div>
            <div className="text-xl font-bold">سیمرغ لجر</div>
          </div>
          <div>
            <h2 className="text-3xl font-extrabold leading-snug">
              سامانهٔ یکپارچهٔ
              <br />
              مدیریت سازمان
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/80">
              منابع انسانی، حضور و غیاب هوشمند، کارتابل و میز کار، مرخصی و
              حسابداری — همه در یک پلتفرم چندشرکتی.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/90">
              {[
                "حضور و غیاب با دستگاه و تشخیص چهره",
                "گردش‌کار مرخصی و کارتابل",
                "تقویم کاری و میز کار تیمی",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-white/50">© سیمرغ لجر — تمامی حقوق محفوظ است</div>
        </div>
      </aside>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">
              س
            </div>
            <h1 className="text-2xl font-bold text-slate-800">سیمرغ لجر</h1>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-800">خوش آمدید 👋</h1>
            <p className="mt-1 text-sm text-slate-500">
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
              <input
                id="email"
                name="email"
                type="email"
                dir="ltr"
                required
                autoComplete="email"
                className="input text-left"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">رمز عبور</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
              />
            </div>
            <SubmitButton />
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            ورود امن — اطلاعات شما رمزنگاری می‌شود
          </p>
        </div>
      </div>
    </main>
  );
}
