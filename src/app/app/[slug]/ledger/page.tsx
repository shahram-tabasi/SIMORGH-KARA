import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";

async function loadAccounts(schema: string) {
  return withTenant(schema, async (tx) =>
    tx<{ id: string; code: string; name: string; type: string }[]>`
      SELECT id, code, name, type FROM ledger_accounts ORDER BY code
    `
  );
}

const typeLabel: Record<string, string> = {
  asset: "دارایی",
  liability: "بدهی",
  equity: "سرمایه",
  income: "درآمد",
  expense: "هزینه",
};

export default async function LedgerPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "ledger.view");
  const accounts = await loadAccounts(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="دفتر کل"
        description="فهرست حساب‌ها و اسناد دوطرفه (ماژول پایه — قابل توسعه)"
      />
      <div className="card">
        {accounts.length === 0 ? (
          <div className="text-center text-sm text-slate-500">
            هنوز سرفصل حسابی تعریف نشده است. ساختار پایهٔ دفتر کل (حساب‌ها، اسناد و
            آرتیکل‌های بدهکار/بستانکار) در دیتابیس آماده است و در گام بعد رابط ثبت
            سند اضافه می‌شود.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">کد</th>
                <th className="pb-2">نام حساب</th>
                <th className="pb-2">نوع</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {a.code}
                  </td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2">{typeLabel[a.type] ?? a.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
