"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { companyLoginAction, type CompanyLoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-brand-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/50 ring-1 ring-amber-400/30 transition hover:ring-amber-400/70 disabled:opacity-60"
    >
      {pending ? "در حال ورود…" : "ورود به سامانه"}
    </button>
  );
}

export function CompanyLoginForm({ slug }: { slug: string }) {
  const [state, formAction] = useFormState<CompanyLoginState, FormData>(companyLoginAction, {});
  const [show, setShow] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {state.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs text-white/65" htmlFor="username">نام کاربری</label>
        <div className="relative">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/80">👤</span>
          <input
            id="username"
            name="username"
            dir="ltr"
            required
            autoComplete="username"
            className="w-full rounded-xl border border-white/10 bg-black/50 px-9 py-2.5 text-left text-sm text-white placeholder:text-white/30 outline-none transition focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
            placeholder="username"
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
  );
}
