import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DOC_KINDS, DOC_STATUS, formatQty, isOutgoing } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";
import {
  approveStockDocAction,
  voidStockDocAction,
  deleteStockDocAction,
} from "../../actions";

interface Doc {
  id: string;
  number: number | null;
  kind: string;
  doc_date: string;
  status: string;
  note: string | null;
  warehouse: string;
  warehouse_id: string;
  to_warehouse: string | null;
  party: string | null;
  member: string | null;
  creator: string | null;
  approver: string | null;
  ledger_entry_id: string | null;
  entry_number: number | null;
}

interface Line {
  id: string;
  code: string;
  name: string;
  unit: string;
  qty: string;
  unit_price: string;
  note: string | null;
  stock: string;
}

async function load(schema: string, id: string) {
  return withTenant(schema, async (tx) => {
    const [doc] = await tx<Doc[]>`
      SELECT d.id, d.number, d.kind, d.doc_date::text, d.status, d.note,
             w.name AS warehouse, d.warehouse_id, tw.name AS to_warehouse,
             p.name AS party, mm.full_name AS member,
             c.full_name AS creator, a.full_name AS approver,
             d.ledger_entry_id, e.number AS entry_number
      FROM stock_docs d
      JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN warehouses tw ON tw.id = d.to_warehouse_id
      LEFT JOIN parties p ON p.id = d.party_id
      LEFT JOIN members mm ON mm.id = d.member_id
      LEFT JOIN members c ON c.id = d.created_by
      LEFT JOIN members a ON a.id = d.approved_by
      LEFT JOIN ledger_entries e ON e.id = d.ledger_entry_id
      WHERE d.id = ${id}
    `;
    if (!doc) return { doc: null, lines: [] as Line[] };
    const lines = await tx<Line[]>`
      SELECT l.id, i.code, i.name, i.unit, l.qty, l.unit_price, l.note,
             COALESCE((SELECT s.qty FROM stock_levels s
                       WHERE s.item_id = l.item_id
                         AND s.warehouse_id = ${doc.warehouse_id}), 0) AS stock
      FROM stock_doc_lines l
      JOIN items i ON i.id = l.item_id
      WHERE l.doc_id = ${id}
      ORDER BY l.sort_order
    `;
    return { doc, lines };
  });
}

export default async function StockDocPage({
  params,
  searchParams,
}: {
  params: { slug: string; id: string };
  searchParams: { error?: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "inventory", "inventory.view");
  const { doc, lines } = await load(ctx.company.schema, params.id);
  if (!doc) notFound();

  const base = `/app/${params.slug}/inventory`;
  const totalQty = lines.reduce((s, l) => s + Number(l.qty), 0);
  const totalValue = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const canApprove = ctx.member.permissions.has("inventory.docs.approve");
  const outgoing = isOutgoing(doc.kind);
  const shortage = outgoing
    ? lines.filter((l) => Number(l.stock) < Number(l.qty))
    : [];

  return (
    <>
      <PageHeader
        title={`${DOC_KINDS[doc.kind as keyof typeof DOC_KINDS]} شمارهٔ ${doc.number ?? "—"}`}
        description={`تاریخ ${doc.doc_date} · انبار ${doc.warehouse}${
          doc.to_warehouse ? ` ← ${doc.to_warehouse}` : ""
        }`}
        action={
          <Link href={`${base}/docs`} className="btn-ghost">
            ← فهرست اسناد
          </Link>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          ثبت‌کننده: {doc.creator ?? "—"}
          {doc.party && ` · طرف‌حساب: ${doc.party}`}
          {doc.member && ` · تحویل: ${doc.member}`}
          {doc.approver && ` · تأییدکننده: ${doc.approver}`}
          {doc.note && ` · ${doc.note}`}
          {doc.ledger_entry_id && (
            <>
              {" · "}
              <Link
                href={`/app/${params.slug}/finance/entries/${doc.ledger_entry_id}`}
                className="text-brand-600 hover:underline"
              >
                سند حسابداری {doc.entry_number ?? ""}
              </Link>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`badge ${
              doc.status === "approved"
                ? "bg-green-100 text-green-700"
                : doc.status === "void"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
            }`}
          >
            {DOC_STATUS[doc.status as keyof typeof DOC_STATUS]}
          </span>
          {doc.status === "draft" && canApprove && (
            <form action={approveStockDocAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="docId" value={doc.id} />
              <button className="btn-primary">تأیید و اعمال در موجودی</button>
            </form>
          )}
          {doc.status === "draft" && (
            <form action={deleteStockDocAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="docId" value={doc.id} />
              <button className="btn-danger">حذف پیش‌نویس</button>
            </form>
          )}
          {doc.status === "approved" && canApprove && (
            <form action={voidStockDocAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="docId" value={doc.id} />
              <button className="btn-danger">ابطال سند</button>
            </form>
          )}
        </div>
      </div>

      {searchParams.error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⛔ {searchParams.error}
        </div>
      )}

      {doc.status === "draft" && shortage.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠ موجودی برای {shortage.length} ردیف کافی نیست؛ تأیید سند تا اصلاح مقدار
          ممکن نخواهد بود.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">کد</th>
              <th className="pb-2">کالا</th>
              <th className="pb-2">مقدار</th>
              <th className="pb-2">واحد</th>
              {outgoing && <th className="pb-2">موجودی فعلی</th>}
              <th className="pb-2">قیمت واحد</th>
              <th className="pb-2">مبلغ</th>
              <th className="pb-2">توضیح</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-2" dir="ltr">
                  {l.code}
                </td>
                <td className="py-2">{l.name}</td>
                <td className="py-2 font-medium">{formatQty(l.qty)}</td>
                <td className="py-2 text-xs text-slate-500">{l.unit}</td>
                {outgoing && (
                  <td
                    className={`py-2 ${
                      Number(l.stock) < Number(l.qty) ? "text-amber-700" : "text-slate-500"
                    }`}
                  >
                    {formatQty(l.stock)}
                  </td>
                )}
                <td className="py-2">{formatAmount(l.unit_price)}</td>
                <td className="py-2">
                  {formatAmount(Number(l.qty) * Number(l.unit_price))}
                </td>
                <td className="py-2 text-xs text-slate-500">{l.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td className="py-2" colSpan={2}>
                جمع
              </td>
              <td className="py-2">{formatQty(totalQty)}</td>
              <td className="py-2" colSpan={outgoing ? 3 : 2}></td>
              <td className="py-2">{formatAmount(totalValue)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
