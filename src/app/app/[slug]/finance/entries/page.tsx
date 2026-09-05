import Link from "next/link";
import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatAmount, ENTRY_STATUS } from "@/lib/finance";

interface Row {
  id: string;
  number: number | null;
  entry_date: string;
  description: string | null;
  status: string;
  total: string;
  creator: string | null;
  lines: number;
}

const statusTone: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  posted: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

async function load(schema: string, status: string) {
  return withTenant(schema, async (tx) =>
    tx<Row[]>`
      SELECT e.id, e.number, e.entry_date::text, e.description, e.status,
             COALESCE((SELECT sum(debit) FROM ledger_lines WHERE entry_id = e.id), 0) AS total,
             (SELECT count(*)::int FROM ledger_lines WHERE entry_id = e.id) AS lines,
             m.full_name AS creator
      FROM ledger_entries e
      LEFT JOIN members m ON m.id = e.created_by
      WHERE ${status === "all" ? tx`true` : tx`e.status = ${status}`}
      ORDER BY e.entry_date DESC, e.number DESC NULLS LAST
      LIMIT 300
    `
  );
}

export default async function EntriesPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { status?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "finance");
  ensurePermission(ctx, "ledger.view");
  const status = searchParams.status ?? "all";
  const entries = await load(ctx.company.schema, status);
  const base = `/app/${params.slug}/finance`;

  return (
    <>
      <PageHeader
        title="اسناد حسابداری"
        description="دفتر روزنامه — همهٔ اسناد پیش‌نویس، قطعی و ابطال‌شده"
        action={
          ctx.member.permissions.has("ledger.manage") ? (
            <Link href={`${base}/entries/new`} className="btn-primary">
              ＋ سند جدید
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["all", "همه"],
          ["draft", ENTRY_STATUS.draft],
          ["posted", ENTRY_STATUS.posted],
          ["void", ENTRY_STATUS.void],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`${base}/entries?status=${key}`}
            className={`badge ${
              status === key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {entries.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">سندی یافت نشد.</div>
        ) : (
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">شماره</th>
                <th className="pb-2">تاریخ</th>
                <th className="pb-2">شرح</th>
                <th className="pb-2">آرتیکل</th>
                <th className="pb-2">مبلغ</th>
                <th className="pb-2">ثبت‌کننده</th>
                <th className="pb-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {e.number ?? "—"}
                  </td>
                  <td className="py-2" dir="ltr">
                    {e.entry_date}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`${base}/entries/${e.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      {e.description || "بدون شرح"}
                    </Link>
                  </td>
                  <td className="py-2" dir="ltr">
                    {e.lines}
                  </td>
                  <td className="py-2">{formatAmount(e.total)}</td>
                  <td className="py-2 text-xs text-slate-500">{e.creator ?? "—"}</td>
                  <td className="py-2">
                    <span className={`badge ${statusTone[e.status]}`}>
                      {ENTRY_STATUS[e.status as keyof typeof ENTRY_STATUS] ?? e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
