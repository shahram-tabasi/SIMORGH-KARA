import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatAmount, ENTRY_STATUS } from "@/lib/finance";
import { postEntryAction, voidEntryAction, deleteEntryAction } from "../../actions";

interface Entry {
  id: string;
  number: number | null;
  entry_date: string;
  description: string | null;
  status: string;
  ref_kind: string | null;
  ref_id: string | null;
  void_reason: string | null;
  creator: string | null;
  poster: string | null;
  posted_at: string | null;
}

interface Line {
  id: string;
  code: string;
  account: string;
  description: string | null;
  party: string | null;
  cost_center: string | null;
  debit: string;
  credit: string;
}

async function load(schema: string, id: string) {
  return withTenant(schema, async (tx) => {
    const [entry] = await tx<Entry[]>`
      SELECT e.id, e.number, e.entry_date::text, e.description, e.status,
             e.ref_kind, e.ref_id, e.void_reason, e.posted_at::text,
             c.full_name AS creator, p.full_name AS poster
      FROM ledger_entries e
      LEFT JOIN members c ON c.id = e.created_by
      LEFT JOIN members p ON p.id = e.posted_by
      WHERE e.id = ${id}
    `;
    if (!entry) return { entry: null, lines: [] as Line[] };
    const lines = await tx<Line[]>`
      SELECT l.id, a.code, a.name AS account, l.description,
             pa.name AS party, cc.name AS cost_center, l.debit, l.credit
      FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      LEFT JOIN parties pa ON pa.id = l.party_id
      LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
      WHERE l.entry_id = ${id}
      ORDER BY l.sort_order
    `;
    return { entry, lines };
  });
}

export default async function EntryPage({
  params,
}: {
  params: { slug: string; id: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "finance", "ledger.view");
  const { entry, lines } = await load(ctx.company.schema, params.id);
  if (!entry) notFound();

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  const canPost = ctx.member.permissions.has("finance.entries.post");
  const canVoid = ctx.member.permissions.has("finance.entries.void");
  const canDelete = ctx.member.permissions.has("ledger.manage");

  return (
    <>
      <PageHeader
        title={`سند شمارهٔ ${entry.number ?? "—"}`}
        description={`تاریخ ${entry.entry_date} · ${entry.description || "بدون شرح"}`}
        action={
          <Link href={`/app/${params.slug}/finance/entries`} className="btn-ghost">
            ← فهرست اسناد
          </Link>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          ثبت‌کننده: {entry.creator ?? "—"}
          {entry.posted_at && ` · قطعی توسط ${entry.poster ?? "—"} در ${entry.posted_at.slice(0, 10)}`}
          {entry.ref_kind === "stock_doc" && " · صادرشده از سند انبار"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`badge ${
              entry.status === "posted"
                ? "bg-green-100 text-green-700"
                : entry.status === "void"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
            }`}
          >
            {ENTRY_STATUS[entry.status as keyof typeof ENTRY_STATUS]}
          </span>

          {entry.status === "draft" && canPost && (
            <form action={postEntryAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="entryId" value={entry.id} />
              <button className="btn-primary">قطعی کردن سند</button>
            </form>
          )}
          {entry.status === "draft" && canDelete && (
            <form action={deleteEntryAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="entryId" value={entry.id} />
              <button className="btn-danger">حذف پیش‌نویس</button>
            </form>
          )}
          {entry.status === "posted" && canVoid && (
            <form action={voidEntryAction} className="flex items-center gap-1.5">
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="entryId" value={entry.id} />
              <input
                name="reason"
                placeholder="علت ابطال"
                className="input !w-40 !py-1 text-xs"
              />
              <button className="btn-danger">ابطال سند</button>
            </form>
          )}
        </div>
      </div>

      {entry.void_reason && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          علت ابطال: {entry.void_reason}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">کد حساب</th>
              <th className="pb-2">حساب</th>
              <th className="pb-2">شرح</th>
              <th className="pb-2">طرف‌حساب</th>
              <th className="pb-2">مرکز هزینه</th>
              <th className="pb-2">بدهکار</th>
              <th className="pb-2">بستانکار</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-2" dir="ltr">
                  {l.code}
                </td>
                <td className="py-2">{l.account}</td>
                <td className="py-2 text-xs text-slate-500">{l.description ?? "—"}</td>
                <td className="py-2 text-xs text-slate-500">{l.party ?? "—"}</td>
                <td className="py-2 text-xs text-slate-500">{l.cost_center ?? "—"}</td>
                <td className="py-2">{Number(l.debit) ? formatAmount(l.debit) : "—"}</td>
                <td className="py-2">{Number(l.credit) ? formatAmount(l.credit) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td className="py-2" colSpan={5}>
                جمع
              </td>
              <td className="py-2">{formatAmount(totalDebit)}</td>
              <td className="py-2">{formatAmount(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
