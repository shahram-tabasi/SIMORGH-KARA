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

// deterministic starfield (stable for SSR)
const STARS = Array.from({ length: 60 }, (_, i) => ({
  top: (i * 73) % 100,
  left: (i * 137) % 100,
  s: (i % 3) + 1,
  o: 0.2 + ((i * 17) % 60) / 100,
}));

function Scene() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* sky gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_-10%,#231a3d_0%,#120d22_45%,#0a0712_100%)]" />
      {/* stars */}
      {STARS.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ top: `${st.top}%`, left: `${st.left}%`, width: st.s, height: st.s, opacity: st.o }}
        />
      ))}
      {/* golden aurora streaks (the divider) */}
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1440 900">
        <defs>
          <linearGradient id="gold" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#b45309" stopOpacity="0" />
            <stop offset="50%" stopColor="#fcd34d" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <g filter="url(#soft)" fill="none" stroke="url(#gold)">
          <path d="M120 880 C520 700 700 520 760 300 C800 150 900 60 1180 30" strokeWidth="2.5" opacity="0.8" />
          <path d="M40 900 C480 760 660 560 720 360 C770 190 880 90 1240 60" strokeWidth="1.4" opacity="0.55" />
          <path d="M220 900 C560 720 760 520 820 280 C870 120 1000 50 1320 20" strokeWidth="1" opacity="0.4" />
        </g>
      </svg>
      {/* isometric "management system" hologram — sits in the gap, behind text */}
      <div className="absolute left-[37%] top-1/2 hidden -translate-y-1/2 opacity-90 lg:block">
        <div className="scale-95 [transform:perspective(1400px)_rotateX(12deg)_rotateY(-22deg)]">
          <div className="relative h-56 w-80 rounded-2xl border border-indigo-300/20 bg-gradient-to-br from-indigo-500/10 to-violet-700/10 p-4 shadow-[0_30px_80px_-20px_rgba(99,102,241,0.5)] backdrop-blur-sm">
            <div className="absolute -inset-px rounded-2xl ring-1 ring-white/5" />
            <div className="mb-3 flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-300/70" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
            </div>
            <div className="flex items-end gap-4">
              {/* donut */}
              <div
                className="h-20 w-20 rounded-full"
                style={{
                  background:
                    "conic-gradient(#fcd34d 0 35%, #818cf8 35% 70%, #c4b5fd 70% 100%)",
                }}
              >
                <div className="m-2 h-16 w-16 rounded-full bg-[#160f2c]" />
              </div>
              {/* bars */}
              <div className="flex h-24 items-end gap-2">
                {[40, 70, 30, 90, 55].map((b, i) => (
                  <span
                    key={i}
                    className="w-3 rounded-t bg-gradient-to-t from-indigo-400/40 to-amber-300/70"
                    style={{ height: `${b}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="h-1.5 w-3/4 rounded bg-white/10" />
              <div className="h-1.5 w-1/2 rounded bg-white/10" />
            </div>
          </div>
          {/* glowing base */}
          <div className="mx-auto mt-3 h-3 w-64 rounded-full bg-violet-500/30 blur-md" />
        </div>
      </div>

      {/* mountains */}
      <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 280" preserveAspectRatio="none">
        <path d="M0 280 L0 150 L180 60 L340 170 L520 90 L700 200 L880 110 L1080 210 L1260 120 L1440 190 L1440 280 Z" fill="#1b1436" opacity="0.7" />
        <path d="M0 280 L0 200 L160 130 L360 220 L560 150 L760 240 L980 160 L1200 250 L1440 180 L1440 280 Z" fill="#120c24" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0712] via-transparent to-transparent" />
    </div>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0712] text-white">
      <Scene />

      {/* top brand mark */}
      <div className="absolute right-8 top-7 z-20 flex items-center gap-2 text-sm text-white/70">
        <span>سیمرغ‌کارا</span>
        <img src="/logo-clean.png" alt="" className="h-9 w-9 object-contain" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center gap-12 px-6 py-16 lg:flex-row lg:justify-between">
        {/* heading + features (far right in RTL) */}
        <section className="order-2 hidden max-w-md text-right lg:order-1 lg:block">
          <h2 className="text-4xl font-extrabold leading-snug">
            <span className="bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500 bg-clip-text text-transparent">
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
              src="/logo-clean.png"
              alt="سیمرغ‌کارا"
              className="mb-3 h-32 w-32 object-contain drop-shadow-[0_0_35px_rgba(245,158,11,0.35)]"
            />
            <h1 className="text-3xl font-extrabold tracking-tight">سیمرغ‌کارا</h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-300/80">
              <span className="h-px w-6 bg-amber-400/40" />
              سامانهٔ هوشمند حضور و غیاب
              <span className="h-px w-6 bg-amber-400/40" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/50 backdrop-blur-md">
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
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-9 py-2.5 text-left text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
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
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-9 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
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

      <div className="absolute bottom-6 left-8 z-20 hidden items-center gap-1.5 text-xs text-white/30 lg:flex">
        <span>🛡</span> سیمرغ‌کارا — تمامی حقوق محفوظ است
      </div>
    </main>
  );
}
