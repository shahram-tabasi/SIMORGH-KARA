import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { AccountEditor } from "../../../AccountEditor";

interface AccountRow {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  status: string;
  created_at: string;
}

export default async function CompanyUsersPage({
  params,
}: {
  params: { id: string };
}) {
  await requirePlatformAdmin();

  const [company] = await sql<
    { id: string; name: string; slug: string; max_users: number }[]
  >`
    SELECT id, name, slug, max_users FROM platform.companies WHERE id = ${params.id}
  `;
  if (!company) notFound();

  const accounts = await sql<AccountRow[]>`
    SELECT id, full_name, email, username, status, created_at::text
    FROM platform.user_accounts
    WHERE company_id = ${company.id} AND NOT is_platform_admin
    ORDER BY created_at
  `;

  return (
    <>
      <PageHeader
        title={`کاربران ${company.name}`}
        description="اصلاح ایمیل ورود، نام کاربری و بازنشانی رمز عبور کاربران این شرکت"
        action={
          <Link href="/admin/companies" className="btn-ghost">
            ← بازگشت به شرکت‌ها
          </Link>
        }
      />

      <div className="card mb-4 text-xs text-slate-500">
        نخستین حساب هر شرکت، «مدیر شرکت» است. اگر ایمیل مدیر اشتباه ثبت شده یا
        رمزش را فراموش کرده، همین‌جا اصلاح و بازنشانی کنید — رمز جدید فقط یک بار
        نمایش داده می‌شود.
        <span className="mx-1 text-slate-400" dir="ltr">
          /app/{company.slug}
        </span>
      </div>

      {accounts.length === 0 ? (
        <div className="card text-sm text-slate-400">
          هنوز کاربری برای این شرکت ثبت نشده است.
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((a, i) => (
            <div key={a.id}>
              {i === 0 && (
                <div className="mb-1 text-xs font-medium text-brand-700">
                  مدیر شرکت
                </div>
              )}
              {i === 1 && (
                <div className="mb-1 mt-5 text-xs font-medium text-slate-500">
                  سایر کاربران
                </div>
              )}
              <AccountEditor
                account={{
                  id: a.id,
                  full_name: a.full_name,
                  email: a.email,
                  username: a.username,
                  status: a.status,
                  scoped: true,
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
