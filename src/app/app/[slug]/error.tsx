"use client";

import Link from "next/link";

/**
 * صفحهٔ خطای پنل شرکت. مجوز نداشتن یا غیرفعال بودن یک پنل، خطای برنامه نیست —
 * به‌جای صفحهٔ خطای عمومی، پیام روشن فارسی نشان داده می‌شود.
 */
export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error.message || "خطای ناشناخته";
  const isAccess =
    message.includes("مجوز") || message.includes("پنل برای شرکت شما فعال نشده");

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="text-4xl">{isAccess ? "🔒" : "⚠️"}</div>
      <h1 className="mt-3 text-lg font-bold text-slate-800">
        {isAccess ? "دسترسی ندارید" : "خطا در نمایش این صفحه"}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {isAccess
          ? message
          : "مشکلی در بارگذاری این بخش پیش آمد. اگر ادامه داشت با مدیر سامانه تماس بگیرید."}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button onClick={reset} className="btn-ghost">
          تلاش دوباره
        </button>
        <Link href="/" className="btn-primary">
          بازگشت به داشبورد
        </Link>
      </div>
    </div>
  );
}
