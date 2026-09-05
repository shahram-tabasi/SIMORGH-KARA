import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { PARTY_KINDS, formatAmount } from "@/lib/finance";
import { PartyForm, CostCenterForm } from "./PartyForm";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const parties = await tx<
      {
        id: string;
        code: string;
        name: string;
        kind: string;
        phone: string | null;
        account: string | null;
        balance: string;
      }[]
    >`
      SELECT p.id, p.code, p.name, p.kind, p.phone, a.name AS account,
             COALESCE((SELECT sum(l.debit - l.credit) FROM ledger_lines l
                       JOIN ledger_entries e ON e.id = l.entry_id
                       WHERE l.party_id = p.id AND e.status = 'posted'), 0) AS balance
      FROM parties p
      LEFT JOIN ledger_accounts a ON a.id = p.account_id
      ORDER BY p.name
    `;
    const costCenters = await tx<
      { id: string; code: string; name: string; is_active: boolean }[]
    >`SELECT id, code, name, is_active FROM cost_centers ORDER BY code`;
    const accounts = await tx<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM ledger_accounts
      WHERE is_group = false ORDER BY code
    `;
    return { parties, costCenters, accounts };
  });
}

export default async function PartiesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "finance", "ledger.view");
  const canParties = ctx.member.permissions.has("finance.parties.manage");
  const canCc = ctx.member.permissions.has("finance.costcenters.manage");
  const { parties, costCenters, accounts } = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="طرف‌حساب‌ها و مراکز هزینه"
        description="مشتری، تأمین‌کننده، پیمانکار و مراکز هزینه‌ای که در آرتیکل‌های سند استفاده می‌شوند"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {canParties && <PartyForm slug={params.slug} accounts={accounts} />}
        {canCc && <CostCenterForm slug={params.slug} />}
      </div>

      <div className="card mb-4 overflow-x-auto">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          طرف‌حساب‌ها
        </h3>
        {parties.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">
            هنوز طرف‌حسابی ثبت نشده است.
          </div>
        ) : (
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">کد</th>
                <th className="pb-2">نام</th>
                <th className="pb-2">نوع</th>
                <th className="pb-2">تلفن</th>
                <th className="pb-2">حساب مرتبط</th>
                <th className="pb-2">مانده (بدهکار مثبت)</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {p.code}
                  </td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2 text-xs text-slate-500">
                    {PARTY_KINDS[p.kind as keyof typeof PARTY_KINDS] ?? p.kind}
                  </td>
                  <td className="py-2 text-xs text-slate-500" dir="ltr">
                    {p.phone ?? "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-500">{p.account ?? "—"}</td>
                  <td className="py-2">{formatAmount(p.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          مراکز هزینه
        </h3>
        {costCenters.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">
            مرکز هزینه‌ای تعریف نشده است.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {costCenters.map((c) => (
              <span key={c.id} className="badge bg-slate-100 text-slate-600">
                {c.code} — {c.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
