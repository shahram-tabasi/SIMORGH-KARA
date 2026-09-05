import Link from "next/link";
import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatAmount, isDebitNature, ACCOUNT_TYPES } from "@/lib/finance";

interface TrialRow {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

interface LedgerRow {
  id: string;
  entry_date: string;
  number: number | null;
  description: string | null;
  line_description: string | null;
  debit: string;
  credit: string;
}

async function load(schema: string, accountId: string | null) {
  return withTenant(schema, async (tx) => {
    const trial = await tx<TrialRow[]>`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(sum(l.debit), 0)  AS debit,
             COALESCE(sum(l.credit), 0) AS credit
      FROM ledger_accounts a
      LEFT JOIN ledger_lines l ON l.account_id = a.id
      LEFT JOIN ledger_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.is_group = false AND e.id IS NOT NULL
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code
    `;
    let detail: LedgerRow[] = [];
    let account: { code: string; name: string } | null = null;
    if (accountId) {
      const [a] = await tx<{ code: string; name: string }[]>`
        SELECT code, name FROM ledger_accounts WHERE id = ${accountId}
      `;
      account = a ?? null;
      detail = await tx<LedgerRow[]>`
        SELECT l.id, e.entry_date::text, e.number, e.description,
               l.description AS line_description, l.debit, l.credit
        FROM ledger_lines l
        JOIN ledger_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${accountId} AND e.status = 'posted'
        ORDER BY e.entry_date, e.number
        LIMIT 500
      `;
    }
    return { trial, detail, account };
  });
}

export default async function FinanceReportsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { account?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "finance");
  ensurePermission(ctx, "finance.reports.view");
  const accountId = searchParams.account ?? null;
  const { trial, detail, account } = await load(ctx.company.schema, accountId);
  const base = `/app/${params.slug}/finance/reports`;

  const totalDebit = trial.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = trial.reduce((s, r) => s + Number(r.credit), 0);

  let running = 0;

  return (
    <>
      <PageHeader
        title="گزارش‌های مالی"
        description="تراز آزمایشی بر پایهٔ اسناد قطعی؛ برای دیدن دفتر معین روی نام هر حساب بزنید"
      />

      <div className="card mb-6 overflow-x-auto">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          تراز آزمایشی
        </h3>
        {trial.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">
            هنوز سند قطعی‌شده‌ای وجود ندارد.
          </div>
        ) : (
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">کد</th>
                <th className="pb-2">حساب</th>
                <th className="pb-2">ماهیت</th>
                <th className="pb-2">گردش بدهکار</th>
                <th className="pb-2">گردش بستانکار</th>
                <th className="pb-2">مانده</th>
              </tr>
            </thead>
            <tbody>
              {trial.map((r) => {
                const d = Number(r.debit);
                const c = Number(r.credit);
                const bal = isDebitNature(r.type) ? d - c : c - d;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2" dir="ltr">
                      {r.code}
                    </td>
                    <td className="py-2">
                      <Link href={`${base}?account=${r.id}`} className="text-brand-600 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {ACCOUNT_TYPES[r.type as keyof typeof ACCOUNT_TYPES] ?? r.type}
                    </td>
                    <td className="py-2">{formatAmount(d)}</td>
                    <td className="py-2">{formatAmount(c)}</td>
                    <td className="py-2 font-medium">{formatAmount(bal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td className="py-2" colSpan={3}>
                  جمع کل
                </td>
                <td className="py-2">{formatAmount(totalDebit)}</td>
                <td className="py-2">{formatAmount(totalCredit)}</td>
                <td className="py-2">
                  <span
                    className={`badge ${
                      Math.abs(totalDebit - totalCredit) < 0.009
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {Math.abs(totalDebit - totalCredit) < 0.009
                      ? "تراز است"
                      : "ناتراز!"}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {account && (
        <div className="card overflow-x-auto">
          <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
            دفتر معین — {account.code} {account.name}
          </h3>
          {detail.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">
              گردشی برای این حساب ثبت نشده است.
            </div>
          ) : (
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-right text-xs text-slate-400">
                  <th className="pb-2">تاریخ</th>
                  <th className="pb-2">سند</th>
                  <th className="pb-2">شرح</th>
                  <th className="pb-2">بدهکار</th>
                  <th className="pb-2">بستانکار</th>
                  <th className="pb-2">مانده</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((l) => {
                  running += Number(l.debit) - Number(l.credit);
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="py-2" dir="ltr">
                        {l.entry_date}
                      </td>
                      <td className="py-2" dir="ltr">
                        {l.number ?? "—"}
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {l.line_description || l.description || "—"}
                      </td>
                      <td className="py-2">{Number(l.debit) ? formatAmount(l.debit) : "—"}</td>
                      <td className="py-2">{Number(l.credit) ? formatAmount(l.credit) : "—"}</td>
                      <td className="py-2 font-medium">{formatAmount(running)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
