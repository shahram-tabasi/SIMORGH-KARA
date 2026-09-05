import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ACCOUNT_TYPES, formatAmount, isDebitNature } from "@/lib/finance";
import { AccountForm } from "./AccountForm";
import { toggleAccountActiveAction } from "../actions";

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  level: number;
  is_group: boolean;
  is_active: boolean;
  parent_id: string | null;
  debit: string;
  credit: string;
}

async function load(schema: string) {
  return withTenant(schema, async (tx) =>
    tx<AccountRow[]>`
      SELECT a.id, a.code, a.name, a.type, a.level, a.is_group, a.is_active,
             a.parent_id,
             COALESCE((SELECT sum(l.debit) FROM ledger_lines l
                       JOIN ledger_entries e ON e.id = l.entry_id
                       WHERE l.account_id = a.id AND e.status = 'posted'), 0) AS debit,
             COALESCE((SELECT sum(l.credit) FROM ledger_lines l
                       JOIN ledger_entries e ON e.id = l.entry_id
                       WHERE l.account_id = a.id AND e.status = 'posted'), 0) AS credit
      FROM ledger_accounts a
      ORDER BY a.code
    `
  );
}

export default async function AccountsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "finance");
  ensurePermission(ctx, "ledger.view");
  const canManage = ctx.member.permissions.has("finance.accounts.manage");
  const accounts = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="کدینگ حساب‌ها"
        description="ساختار درختی حساب‌های کل، معین و تفصیلی به‌همراه گردش قطعی هر حساب"
      />

      {canManage && (
        <div className="mb-6">
          <AccountForm
            slug={params.slug}
            parents={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">کد</th>
              <th className="pb-2">نام حساب</th>
              <th className="pb-2">ماهیت</th>
              <th className="pb-2">بدهکار</th>
              <th className="pb-2">بستانکار</th>
              <th className="pb-2">مانده</th>
              {canManage && <th className="pb-2">وضعیت</th>}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const debit = Number(a.debit);
              const credit = Number(a.credit);
              const balance = isDebitNature(a.type) ? debit - credit : credit - debit;
              return (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {a.code}
                  </td>
                  <td className="py-2" style={{ paddingRight: (a.level - 1) * 16 }}>
                    <span className={a.is_group ? "font-semibold text-slate-700" : ""}>
                      {a.name}
                    </span>
                    {!a.is_active && (
                      <span className="badge mr-2 bg-slate-100 text-slate-500">غیرفعال</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {ACCOUNT_TYPES[a.type as keyof typeof ACCOUNT_TYPES] ?? a.type}
                  </td>
                  <td className="py-2">{formatAmount(debit)}</td>
                  <td className="py-2">{formatAmount(credit)}</td>
                  <td className="py-2 font-medium">{formatAmount(balance)}</td>
                  {canManage && (
                    <td className="py-2">
                      <form action={toggleAccountActiveAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={a.id} />
                        <button className="text-xs text-brand-600 hover:underline">
                          {a.is_active ? "غیرفعال کن" : "فعال کن"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
