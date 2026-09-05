import { requirePlatformAdmin } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ProfileForm, PasswordForm } from "./OwnAccountForms";

export default async function AdminAccountPage() {
  const { session } = await requirePlatformAdmin();

  const [account] = await sql<
    { full_name: string; email: string; created_at: string }[]
  >`
    SELECT full_name, email, created_at::text
    FROM platform.user_accounts WHERE id = ${session.sub}
  `;

  return (
    <>
      <PageHeader
        title="حساب من"
        description="ایمیل ورود، نام نمایشی و رمز عبور حساب مدیر سیمرغ"
      />

      <div className="space-y-4">
        <ProfileForm fullName={account.full_name} email={account.email} />
        <PasswordForm />

        <div className="card text-xs text-slate-500">
          <div className="mb-1 font-medium text-slate-700">بازیابی رمز فراموش‌شده</div>
          <p className="leading-6">
            بازیابی خودکار با ایمیل هنوز فعال نیست (سامانه سرویس ارسال ایمیل
            ندارد). اگر رمز مدیر سیمرغ فراموش شد، از طریق سرور و با اجرای
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5" dir="ltr">
              npm run db:seed
            </code>
            رمز حساب سوپرادمینِ تعریف‌شده در فایل
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5" dir="ltr">
              .env
            </code>
            دوباره تنظیم می‌شود. رمز مدیران شرکت‌ها و هولدینگ‌ها را می‌توانید
            مستقیماً از همین پنل بازنشانی کنید.
          </p>
        </div>
      </div>
    </>
  );
}
