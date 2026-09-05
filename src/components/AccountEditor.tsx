"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
/** Shared shape of the account-management action results. */
export interface AccountState {
  error?: string;
  ok?: string;
  /** Set only after a password reset — shown to the operator once. */
  password?: string;
}

export type AccountFormAction = (
  prev: AccountState,
  formData: FormData
) => Promise<AccountState>;

export interface ManagedAccount {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  status: string;
  /** Company-scoped accounts get a username field; holding admins do not. */
  scoped: boolean;
}

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-ghost" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/**
 * Edit one account's login: correct the e-mail, set a username, reset the
 * password, or suspend the login.
 *
 * The actions are passed in, so the very same UI serves whoever is allowed to
 * do it at that level — the platform admin over holdings and companies, and a
 * holding admin over its own subsidiaries.
 */
export function AccountEditor({
  account,
  saveAction: save,
  resetAction: reset,
  statusAction,
}: {
  account: ManagedAccount;
  saveAction: AccountFormAction;
  resetAction: AccountFormAction;
  statusAction: (formData: FormData) => void | Promise<void>;
}) {
  const [saveState, saveAction] = useFormState<AccountState, FormData>(save, {});
  const [resetState, resetAction] = useFormState<AccountState, FormData>(reset, {});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [resetState.password]);

  const disabled = account.status !== "active";

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{account.full_name}</span>
            {disabled && (
              <span className="badge bg-red-100 text-red-700">غیرفعال</span>
            )}
          </div>
          <div className="text-xs text-slate-400" dir="ltr">
            {account.email}
            {account.username ? ` · ${account.username}` : ""}
          </div>
        </div>
        <form action={statusAction}>
          <input type="hidden" name="accountId" value={account.id} />
          <button className={disabled ? "btn-ghost" : "btn-danger"}>
            {disabled ? "فعال‌سازی ورود" : "غیرفعال‌کردن ورود"}
          </button>
        </form>
      </div>

      {/* ── اصلاح ایمیل / نام / نام کاربری ── */}
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="accountId" value={account.id} />
        {saveState.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {saveState.error}
          </div>
        )}
        {saveState.ok && (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {saveState.ok}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">نام و نام خانوادگی</label>
            <input
              name="fullName"
              defaultValue={account.full_name}
              required
              className="input"
            />
          </div>
          <div>
            <label className="label">ایمیل ورود</label>
            <input
              name="email"
              type="email"
              dir="ltr"
              defaultValue={account.email}
              required
              className="input text-left"
            />
          </div>
          {account.scoped ? (
            <div>
              <label className="label">نام کاربری شرکت</label>
              <input
                name="username"
                dir="ltr"
                defaultValue={account.username ?? ""}
                className="input text-left"
                placeholder="اختیاری"
              />
            </div>
          ) : (
            <input type="hidden" name="username" value={account.username ?? ""} />
          )}
        </div>
        <div className="flex justify-end">
          <Submit label="ذخیرهٔ اطلاعات" busy="در حال ذخیره…" />
        </div>
      </form>

      {/* ── بازنشانی رمز عبور ── */}
      <form
        action={resetAction}
        className="mt-3 space-y-3 border-t border-slate-100 pt-3"
      >
        <input type="hidden" name="accountId" value={account.id} />
        {resetState.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {resetState.error}
          </div>
        )}
        {resetState.password && (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            <div>{resetState.ok}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-white/70 px-2 py-1 text-sm" dir="ltr">
                {resetState.password}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(resetState.password ?? "")
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="text-xs text-brand-600 hover:underline"
              >
                {copied ? "کپی شد" : "کپی"}
              </button>
            </div>
            <div className="mt-1 text-[11px]">
              این رمز فقط همین یک بار نمایش داده می‌شود؛ آن را به صاحب حساب
              بدهید و از او بخواهید پس از ورود تغییرش دهد.
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label className="label">رمز عبور جدید</label>
            <input
              name="newPassword"
              type="text"
              dir="ltr"
              className="input text-left"
              placeholder="خالی بگذارید تا رمز پیش‌فرض ۱۲۳۴۵۶ تنظیم شود"
              autoComplete="off"
            />
          </div>
          <Submit label="بازنشانی رمز عبور" busy="در حال بازنشانی…" />
        </div>
      </form>
    </div>
  );
}
