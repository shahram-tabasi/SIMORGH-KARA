import Link from "next/link";
import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DOC_KINDS, DOC_STATUS, formatQty } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";

interface Row {
  id: string;
  number: number | null;
  kind: string;
  doc_date: string;
  status: string;
  warehouse: string;
  to_warehouse: string | null;
  creator: string | null;
  qty: string;
  value: string;
}

const statusTone: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

async function load(schema: string, status: string, kind: string) {
  return withTenant(schema, async (tx) =>
    tx<Row[]>`
      SELECT d.id, d.number, d.kind, d.doc_date::text, d.status,
             w.name AS warehouse, tw.name AS to_warehouse,
             m.full_name AS creator,
             COALESCE((SELECT sum(qty) FROM stock_doc_lines WHERE doc_id = d.id), 0) AS qty,
             COALESCE((SELECT sum(qty * unit_price) FROM stock_doc_lines WHERE doc_id = d.id), 0) AS value
      FROM stock_docs d
      JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN warehouses tw ON tw.id = d.to_warehouse_id
      LEFT JOIN members m ON m.id = d.created_by
      WHERE ${status === "all" ? tx`true` : tx`d.status = ${status}`}
        AND ${kind === "all" ? tx`true` : tx`d.kind = ${kind}`}
      ORDER BY d.doc_date DESC, d.created_at DESC
      LIMIT 300
    `
  );
}

export default async function StockDocsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { status?: string; kind?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "inventory");
  ensurePermission(ctx, "inventory.view");
  const status = searchParams.status ?? "all";
  const kind = searchParams.kind ?? "all";
  const docs = await load(ctx.company.schema, status, kind);
  const base = `/app/${params.slug}/inventory`;

  return (
    <>
      <PageHeader
        title="اسناد انبار"
        description="رسید ورود، حواله خروج، انتقال و اصلاح موجودی"
        action={
          <Link href={`${base}/docs/new`} className="btn-primary">
            ＋ سند جدید
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[["all", "همه وضعیت‌ها"], ...Object.entries(DOC_STATUS)].map(([k, label]) => (
          <Link
            key={k}
            href={`${base}/docs?status=${k}&kind=${kind}`}
            className={`badge ${
              status === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {[["all", "همه انواع"], ...Object.entries(DOC_KINDS)].map(([k, label]) => (
          <Link
            key={k}
            href={`${base}/docs?status=${status}&kind=${k}`}
            className={`badge ${
              kind === k ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {docs.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">سندی یافت نشد.</div>
        ) : (
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">شماره</th>
                <th className="pb-2">نوع</th>
                <th className="pb-2">تاریخ</th>
                <th className="pb-2">انبار</th>
                <th className="pb-2">مقدار</th>
                <th className="pb-2">مبلغ</th>
                <th className="pb-2">ثبت‌کننده</th>
                <th className="pb-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    <Link href={`${base}/docs/${d.id}`} className="text-brand-600 hover:underline">
                      {d.number ?? "—"}
                    </Link>
                  </td>
                  <td className="py-2 text-xs text-slate-600">
                    {DOC_KINDS[d.kind as keyof typeof DOC_KINDS] ?? d.kind}
                  </td>
                  <td className="py-2" dir="ltr">
                    {d.doc_date}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {d.warehouse}
                    {d.to_warehouse ? ` ← ${d.to_warehouse}` : ""}
                  </td>
                  <td className="py-2">{formatQty(d.qty)}</td>
                  <td className="py-2">{formatAmount(d.value)}</td>
                  <td className="py-2 text-xs text-slate-500">{d.creator ?? "—"}</td>
                  <td className="py-2">
                    <span className={`badge ${statusTone[d.status]}`}>
                      {DOC_STATUS[d.status as keyof typeof DOC_STATUS] ?? d.status}
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
