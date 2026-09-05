import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHolding } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { AccountEditor } from "@/components/AccountEditor";
import {
  updateHoldingUserAction,
  resetHoldingUserPasswordAction,
  setHoldingUserStatusAction,
} from "../../../actions";

interface AccountRow {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  status: string;
}

export default async function HoldingCompanyUsersPage({
  params,
}: {
  params: { id: string };
}) {
  const { holding } = await requireHolding();

  // The company must belong to this holding — otherwise it does not exist here.
  const [company] = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug FROM platform.companies
    WHERE id = ${params.id} AND holding_id = ${holding.id}
  `;
  if (!company) notFound();

  const accounts = await sql<AccountRow[]>`
    SELECT id, full_name, email, username, status
    FROM platform.user_accounts
    WHERE company_id = ${company.id} AND NOT is_platform_admin
    ORDER BY created_at
  `;

  return (
    <>
      <PageHeader
        title={`کاربران ${company.name}`}
        description="اصلاح ایمیل ورود و بازنشانی رمز عبور کاربران این شرکت زیرمجموعه"
        action={
          <Link href="/holding" className="btn-ghost">
            ← بازگشت به شرکت‌ها
          </Link>
        }
      />

      <div className="card mb-4 text-xs text-slate-500">
        نخستین حساب هر شرکت، «مدیر شرکت» است. رمز بازنشانی‌شده فقط یک بار نمایش
        داده می‌شود؛ آن را به صاحب حساب بدهید و از او بخواهید پس از ورود در
        «پروفایل من» تغییرش دهد.
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
                saveAction={updateHoldingUserAction}
                resetAction={resetHoldingUserPasswordAction}
                statusAction={setHoldingUserStatusAction}
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
