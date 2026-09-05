import { requireHolding } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { HoldingProfileForm, HoldingPasswordForm } from "./HoldingAccountForms";

export default async function HoldingAccountPage() {
  const { session } = await requireHolding();

  const [account] = await sql<{ full_name: string; email: string }[]>`
    SELECT full_name, email FROM platform.user_accounts WHERE id = ${session.sub}
  `;

  return (
    <>
      <PageHeader
        title="حساب من"
        description="ایمیل ورود، نام و رمز عبور حساب مدیر هولدینگ"
      />
      <div className="space-y-4">
        <HoldingProfileForm
          fullName={account?.full_name ?? ""}
          email={account?.email ?? ""}
        />
        <HoldingPasswordForm />
        <div className="card text-xs text-slate-500">
          اگر رمز خودتان را فراموش کردید، مدیر سیمرغ (پشتیبانی) آن را برایتان
          بازنشانی می‌کند. رمز کاربران شرکت‌های زیرمجموعه را خودتان از صفحهٔ
          «کاربران و رمزها»ی همان شرکت بازنشانی کنید.
        </div>
      </div>
    </>
  );
}
