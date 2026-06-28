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
      className="relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-brand-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/40 ring-1 ring-amber-400/30 transition hover:ring-amber-400/60 disabled:opacity-60"
    >
      <span>↩</span>
      {pending ? "در حال ورود…" : "ورود به سامانه"}
      <span className="absolute inset-x-6 -bottom-px h-px bg-gradient-to-l from-transparent via-amber-400 to-transparent" />
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
    <main className="relative min-h-screen overflow-hidden bg-[#0c0a16] text-white">
      {/* atmospheric gold / violet glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[28rem] w-[28rem] rounded-full bg-indigo-700/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-[40rem] rotate-12 rounded-full bg-amber-600/5 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-bl from-transparent via-transparent to-black/40" />
      </div>

      {/* top brand mark */}
      <div className="absolute left-8 top-7 z-10 flex items-center gap-2 text-sm text-white/70">
        <span>سیمرغ‌کارا</span>
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-cover mix-blend-screen" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center gap-10 px-6 py-16 lg:flex-row lg:justify-between">
        {/* brand / features (right in RTL) */}
        <section className="order-2 hidden max-w-md lg:order-1 lg:block">
          <h2 className="text-4xl font-extrabold leading-snug">
            <span className="bg-gradient-to-l from-amber-300 to-amber-500 bg-clip-text text-transparent">
              سامانهٔ یکپارچهٔ
            </span>
            <br />
            مدیریت سازمان
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-white/70">
            منابع انسانی، حضور و غیاب هوشمند، کارتابل و میز کار، مرخصی و
            حسابداری — همه در یک پلتفرم چندشرکتی.
          </p>
          <ul className="mt-8 space-y-3.5 text-sm text-white/85">
            {FEATURES.map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/15 text-xs text-amber-300 ring-1 ring-amber-400/30">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* logo + form (left in RTL) */}
        <section className="order-1 w-full max-w-sm lg:order-2">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt="سیمرغ‌کارا"
              className="mb-3 h-32 w-32 object-contain mix-blend-screen drop-shadow-[0_0_25px_rgba(245,158,11,0.25)]"
            />
            <h1 className="text-3xl font-extrabold tracking-tight">سیمرغ‌کارا</h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-300/80">
              <span className="h-px w-6 bg-amber-400/40" />
              سامانهٔ هوشمند حضور و غیاب
              <span className="h-px w-6 bg-amber-400/40" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="mb-5 text-center">
              <h2 className="text-xl font-bold">خوش آمدید</h2>
              <p className="mt-1 text-xs text-white/50">
                برای ورود، ایمیل و رمز عبور خود را وارد کنید.
              </p>
            </div>

            <form action={formAction} className="space-y-4">
              {state.error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {state.error}
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs text-white/60" htmlFor="email">ایمیل</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/70">✉</span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    dir="ltr"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-9 py-2.5 text-left text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-white/60" htmlFor="password">رمز عبور</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/70">🔒</span>
                  <input
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-9 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    aria-label="نمایش رمز"
                  >
                    {show ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <SubmitButton />
            </form>

            <p className="mt-5 text-center text-xs text-white/40">
              🛡 ورود امن — اطلاعات شما رمزنگاری می‌شود
            </p>
          </div>
        </section>
      </div>

      <div className="absolute bottom-6 right-8 z-10 hidden items-center gap-1.5 text-xs text-white/30 lg:flex">
        <span>🛡</span> سیمرغ‌کارا — تمامی حقوق محفوظ است
      </div>
    </main>
  );
}
