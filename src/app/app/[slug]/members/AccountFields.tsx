"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  setMemberEmailAction,
  resetMemberPasswordAction,
  type MemberAccountState,
} from "../actions";

const inputCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left text-sm outline-none focus:border-brand-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200";

function SaveBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary !px-3 !py-1.5 text-sm" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

/**
 * ایمیل ورود و بازنشانی رمز عبور یک عضو — کنار «نام کاربری ورود» در کارت هر
 * نفر. رمز جدید فقط یک بار نمایش داده می‌شود.
 */
export function AccountFields({
  slug,
  memberId,
  email,
  isSelf,
}: {
  slug: string;
  memberId: string;
  email: string;
  isSelf: boolean;
}) {
  const [emailState, emailAction] = useFormState<MemberAccountState, FormData>(
    setMemberEmailAction,
    {}
  );
  const [pwState, pwAction] = useFormState<MemberAccountState, FormData>(
    resetMemberPasswordAction,
    {}
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [pwState.password]);

  return (
    <div className="space-y-2">
      <form action={emailAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="memberId" value={memberId} />
        <input
          name="email"
          type="email"
          defaultValue={email}
          dir="ltr"
          placeholder="name@company.ir"
          className={`w-60 ${inputCls}`}
        />
        <SaveBtn label="ذخیرهٔ ایمیل" />
        {emailState.error && (
          <span className="text-[11px] text-red-600">{emailState.error}</span>
        )}
        {emailState.ok && (
          <span className="text-[11px] text-green-600">{emailState.ok}</span>
        )}
      </form>

      {isSelf ? (
        <div className="text-[11px] text-slate-400">
          🔒 رمز خودتان را از «پروفایل من» تغییر دهید (رمز فعلی پرسیده می‌شود).
        </div>
      ) : (
        <form action={pwAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="memberId" value={memberId} />
          <input
            name="newPassword"
            type="text"
            dir="ltr"
            autoComplete="off"
            placeholder="خالی = رمز پیش‌فرض ۱۲۳۴۵۶"
            className={`w-60 ${inputCls}`}
          />
          <SaveBtn label="بازنشانی رمز" />
          {pwState.error && (
            <span className="text-[11px] text-red-600">{pwState.error}</span>
          )}
        </form>
      )}

      {pwState.password && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          <div className="flex flex-wrap items-center gap-2">
            <span>{pwState.ok}</span>
            <code className="rounded bg-white/70 px-2 py-0.5 text-sm" dir="ltr">
              {pwState.password}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(pwState.password ?? "")
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              className="text-brand-600 hover:underline"
            >
              {copied ? "کپی شد" : "کپی"}
            </button>
          </div>
          <div className="mt-1 text-[11px]">
            فقط همین یک بار نمایش داده می‌شود؛ به صاحب حساب بدهید و از او بخواهید
            پس از ورود آن را تغییر دهد.
          </div>
        </div>
      )}
    </div>
  );
}
