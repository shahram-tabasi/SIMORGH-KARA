import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatAmount, ACCOUNT_TYPES, isDebitNature } from "@/lib/finance";
import { toFaDigits } from "@/lib/jalali";

interface Totals {
  type: string;
  debit: string;
  credit: string;
}

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const totals = await tx<Totals[]>`
      SELECT a.type,
             COALESCE(sum(l.debit), 0)  AS debit,
             COALESCE(sum(l.credit), 0) AS credit
      FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
      WHERE e.status = 'posted'
      GROUP BY a.type
    `;
    const [counts] = await tx<
      { drafts: number; posted: number; accounts: number; parties: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM ledger_entries WHERE status = 'draft')  AS drafts,
        (SELECT count(*)::int FROM ledger_entries WHERE status = 'posted') AS posted,
        (SELECT count(*)::int FROM ledger_accounts)                        AS accounts,
        (SELECT count(*)::int FROM parties)                                AS parties
    `;
    const recent = await tx<
      {
        id: string;
        number: number | null;
        entry_date: string;
        description: string | null;
        status: string;
        total: string;
      }[]
    >`
      SELECT e.id, e.number, e.entry_date::text, e.description, e.status,
             COALESCE((SELECT sum(debit) FROM ledger_lines WHERE entry_id = e.id), 0) AS total
      FROM ledger_entries e
      ORDER BY e.created_at DESC LIMIT 8
    `;
    const [fy] = await tx<{ title: string; is_closed: boolean }[]>`
      SELECT title, is_closed FROM fiscal_years
      WHERE is_active = true ORDER BY start_date DESC LIMIT 1
    `;
    return { totals, counts, recent, fy };
  });
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

export default async function FinanceHome({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "finance", "ledger.view");
  const { totals, counts, recent, fy } = await load(ctx.company.schema);
  const base = `/app/${params.slug}/finance`;

  const balanceOf = (type: string) => {
    const t = totals.find((x) => x.type === type);
    if (!t) return 0;
    const d = Number(t.debit);
    const c = Number(t.credit);
    return isDebitNature(type) ? d - c : c - d;
  };

  return (
    <>
      <PageHeader
        title="مالی — سیمرغ لجر"
        description={`حسابداری دوطرفه، اسناد، طرف‌حساب و گزارش‌های مالی${
          fy ? ` · ${fy.title}${fy.is_closed ? " (بسته)" : ""}` : ""
        }`}
        action={
          ctx.member.permissions.has("ledger.manage") ? (
            <Link href={`${base}/entries/new`} className="btn-primary">
              ＋ سند جدید
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="جمع دارایی‌ها" value={formatAmount(balanceOf("asset"))} />
        <Kpi label="جمع بدهی‌ها" value={formatAmount(balanceOf("liability"))} />
        <Kpi label="درآمد دوره" value={formatAmount(balanceOf("income"))} />
        <Kpi label="هزینهٔ دوره" value={formatAmount(balanceOf("expense"))} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="اسناد قطعی" value={toFaDigits(counts.posted)} />
        <Kpi label="اسناد پیش‌نویس" value={toFaDigits(counts.drafts)} hint="در انتظار قطعی‌شدن" />
        <Kpi label="سرفصل حساب" value={toFaDigits(counts.accounts)} />
        <Kpi label="طرف‌حساب" value={toFaDigits(counts.parties)} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-semibold text-slate-700">آخرین اسناد</h3>
          <Link href={`${base}/entries`} className="text-xs text-brand-600 hover:underline">
            همهٔ اسناد ←
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">
            هنوز سندی ثبت نشده است.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">شماره</th>
                <th className="pb-2">تاریخ</th>
                <th className="pb-2">شرح</th>
                <th className="pb-2">مبلغ</th>
                <th className="pb-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {e.number ?? "—"}
                  </td>
                  <td className="py-2" dir="ltr">
                    {e.entry_date}
                  </td>
                  <td className="py-2">
                    <Link href={`${base}/entries/${e.id}`} className="text-brand-600 hover:underline">
                      {e.description || "بدون شرح"}
                    </Link>
                  </td>
                  <td className="py-2">{formatAmount(e.total)}</td>
                  <td className="py-2">
                    <span
                      className={`badge ${
                        e.status === "posted"
                          ? "bg-green-100 text-green-700"
                          : e.status === "void"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {e.status === "posted" ? "قطعی" : e.status === "void" ? "ابطال" : "پیش‌نویس"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${base}/accounts`} className="card hover:border-brand-300">
          <div className="text-sm font-semibold text-slate-700">📚 کدینگ حساب‌ها</div>
          <div className="mt-1 text-xs text-slate-400">
            سرفصل‌های کل، معین و تفصیلی — {toFaDigits(counts.accounts)} حساب
          </div>
        </Link>
        <Link href={`${base}/parties`} className="card hover:border-brand-300">
          <div className="text-sm font-semibold text-slate-700">🤝 طرف‌حساب‌ها</div>
          <div className="mt-1 text-xs text-slate-400">مشتری، تأمین‌کننده، پیمانکار و مراکز هزینه</div>
        </Link>
        <Link href={`${base}/reports`} className="card hover:border-brand-300">
          <div className="text-sm font-semibold text-slate-700">📈 گزارش‌های مالی</div>
          <div className="mt-1 text-xs text-slate-400">تراز آزمایشی، دفتر معین و دفتر روزنامه</div>
        </Link>
      </div>

      <div className="mt-4 text-[11px] text-slate-400">
        ماهیت حساب‌ها: {Object.entries(ACCOUNT_TYPES).map(([k, v]) => `${v}`).join(" · ")}
      </div>
    </>
  );
}
