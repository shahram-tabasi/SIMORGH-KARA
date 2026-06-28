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
      className="relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-brand-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/50 ring-1 ring-amber-400/30 transition hover:ring-amber-400/70 disabled:opacity-60"
    >
      <span>↩</span>
      {pending ? "در حال ورود…" : "ورود به سامانه"}
      <span className="absolute inset-x-8 -bottom-px h-px bg-gradient-to-l from-transparent via-amber-300 to-transparent" />
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
    <main
      className="relative min-h-screen overflow-hidden bg-[#0a0712] bg-cover bg-center bg-no-repeat text-white"
      style={{ backgroundImage: "url('/welcome-bg.jpg')" }}
    >
      {/* readability overlay — darker on the edges where text sits, clear center */}
      <div className="absolute inset-0 bg-[#0a0712]/40" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0a0712]/90 via-[#0a0712]/10 to-[#0a0712]/65" />

      {/* top brand mark */}
      <div className="absolute right-6 top-6 z-20 flex items-center gap-2 text-sm text-white/75">
        <span>سیمرغ‌کارا</span>
        <img src="/logo-clean.png" alt="" className="h-9 w-9 object-contain" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-12 px-6 py-16 lg:flex-row lg:justify-between">
        {/* heading + features (far right in RTL) */}
        <section className="order-2 hidden max-w-md text-right lg:order-1 lg:block">
          <h2 className="text-4xl font-extrabold leading-snug drop-shadow-lg">
            <span className="bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500 bg-clip-text text-transparent">
              سامانهٔ یکپارچهٔ
            </span>
            <br />
            مدیریت سازمان
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/75">
            منابع انسانی، حضور و غیاب هوشمند، کارتابل و میز کار، مرخصی و
            حسابداری — همه در یک پلتفرم چندشرکتی.
          </p>
          <ul className="mt-8 space-y-3.5 text-sm text-white/90">
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
              src="/logo-clean.png"
              alt="سیمرغ‌کارا"
              className="mb-3 h-28 w-28 object-contain drop-shadow-[0_0_35px_rgba(245,158,11,0.4)]"
            />
            <h1 className="text-3xl font-extrabold tracking-tight drop-shadow">سیمرغ‌کارا</h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-300/90">
              <span className="h-px w-6 bg-amber-400/40" />
              سامانهٔ هوشمند حضور و غیاب
              <span className="h-px w-6 bg-amber-400/40" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="mb-5 text-center">
              <h2 className="text-xl font-bold">خوش آمدید</h2>
              <p className="mt-1 text-xs text-white/55">
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
                <label className="mb-1.5 block text-xs text-white/65" htmlFor="email">ایمیل</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/80">✉</span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    dir="ltr"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-9 py-2.5 text-left text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-white/65" htmlFor="password">رمز عبور</label>
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/80">🔒</span>
                  <input
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-9 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
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

            <p className="mt-5 text-center text-xs text-white/45">
              🛡 ورود امن — اطلاعات شما رمزنگاری می‌شود
            </p>
          </div>
        </section>
      </div>

      <div className="absolute bottom-5 left-6 z-20 hidden items-center gap-1.5 text-xs text-white/35 lg:flex">
        <span>🛡</span> سیمرغ‌کارا — تمامی حقوق محفوظ است
      </div>
    </main>
  );
}
