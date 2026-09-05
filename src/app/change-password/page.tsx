import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ChangeForm } from "./ChangeForm";

export const dynamic = "force-dynamic";

/**
 * تغییر اجباری رمز — صفحه‌ای بیرون از پنل‌ها (بدون منوی کناری) تا کاربر تا
 * پیش از انتخاب رمز شخصی خودش وارد بخش‌های دیگر نشود.
 */
export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [account] = await sql<
    { full_name: string; email: string; must_change_password: boolean }[]
  >`
    SELECT full_name, email, must_change_password
    FROM platform.user_accounts WHERE id = ${session.sub}
  `;
  if (!account) redirect("/login");

  // Nothing to force — send them back where they belong.
  if (!account.must_change_password) {
    redirect(
      session.kind === "platform"
        ? "/admin"
        : session.kind === "holding"
          ? "/holding"
          : `/app/${session.slug}`
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-[#0a0712]">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-11 w-11 rounded-xl object-cover" />
          <div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-100">
              سیمرغ‌کارا
            </div>
            <div className="text-xs text-slate-400">انتخاب رمز عبور شخصی</div>
          </div>
        </div>

        <div className="card">
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            🔒 رمز فعلی شما را مدیر تعیین کرده است. برای ادامه، یک رمز شخصی
            انتخاب کنید — تا آن زمان بخش‌های دیگر باز نمی‌شوند.
          </div>

          <div className="mb-4 text-xs text-slate-500">
            {account.full_name}
            <span className="mr-1 text-slate-400" dir="ltr">
              {account.email}
            </span>
          </div>

          <ChangeForm isDefault />

          <div className="mt-4 border-t border-slate-100 pt-3 text-center">
            <Link href="/logout" className="text-xs text-slate-400 hover:underline">
              خروج از حساب
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
