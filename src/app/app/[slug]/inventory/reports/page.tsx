import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DOC_KINDS, formatQty } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";

interface KardexRow {
  doc_id: string;
  number: number | null;
  kind: string;
  doc_date: string;
  warehouse: string;
  qty: string;
  unit_price: string;
}

async function load(schema: string, itemId: string | null) {
  return withTenant(schema, async (tx) => {
    const items = await tx<
      { id: string; code: string; name: string; unit: string; min_stock: string; qty: string }[]
    >`
      SELECT i.id, i.code, i.name, i.unit, i.min_stock,
             COALESCE((SELECT sum(s.qty) FROM stock_levels s WHERE s.item_id = i.id), 0) AS qty
      FROM items i WHERE i.is_active = true ORDER BY i.code
    `;
    let kardex: KardexRow[] = [];
    let item: { code: string; name: string; unit: string } | null = null;
    if (itemId) {
      const [it] = await tx<{ code: string; name: string; unit: string }[]>`
        SELECT code, name, unit FROM items WHERE id = ${itemId}
      `;
      item = it ?? null;
      kardex = await tx<KardexRow[]>`
        SELECT m.doc_id, m.number, m.kind, m.doc_date::text, m.qty, m.unit_price,
               w.name AS warehouse
        FROM stock_moves m
        JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.item_id = ${itemId} AND m.status = 'approved'
        ORDER BY m.doc_date, m.number
        LIMIT 500
      `;
    }
    return { items, kardex, item };
  });
}

export default async function InventoryReportsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { item?: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "inventory", "inventory.reports.view");
  const itemId = searchParams.item ?? null;
  const { items, kardex, item } = await load(ctx.company.schema, itemId);
  const base = `/app/${params.slug}/inventory/reports`;

  const low = items.filter((i) => Number(i.qty) <= Number(i.min_stock));
  let running = 0;

  return (
    <>
      <PageHeader
        title="گزارش‌های انبار"
        description="کاردکس هر کالا و فهرست کالاهای زیر نقطهٔ سفارش"
      />

      <div className="card mb-6">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          کالاهای زیر نقطهٔ سفارش
        </h3>
        {low.length === 0 ? (
          <div className="py-3 text-center text-sm text-slate-400">
            همهٔ کالاها بالای نقطهٔ سفارش هستند.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {low.map((i) => (
              <Link
                key={i.id}
                href={`${base}?item=${i.id}`}
                className="badge bg-amber-100 text-amber-700"
              >
                {i.name}: {formatQty(i.qty)} {i.unit} (حد: {formatQty(i.min_stock)})
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          انتخاب کالا برای کاردکس
        </h3>
        <div className="flex flex-wrap gap-2">
          {items.map((i) => (
            <Link
              key={i.id}
              href={`${base}?item=${i.id}`}
              className={`badge ${
                itemId === i.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {i.code} — {i.name}
            </Link>
          ))}
        </div>
      </div>

      {item && (
        <div className="card overflow-x-auto">
          <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
            کاردکس {item.name} ({item.unit})
          </h3>
          {kardex.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">
              گردشی برای این کالا ثبت نشده است.
            </div>
          ) : (
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-right text-xs text-slate-400">
                  <th className="pb-2">تاریخ</th>
                  <th className="pb-2">سند</th>
                  <th className="pb-2">نوع</th>
                  <th className="pb-2">انبار</th>
                  <th className="pb-2">ورود</th>
                  <th className="pb-2">خروج</th>
                  <th className="pb-2">مانده</th>
                  <th className="pb-2">قیمت واحد</th>
                </tr>
              </thead>
              <tbody>
                {kardex.map((k, idx) => {
                  const q = Number(k.qty);
                  running += q;
                  return (
                    <tr key={`${k.doc_id}-${idx}`} className="border-t border-slate-100">
                      <td className="py-2" dir="ltr">
                        {k.doc_date}
                      </td>
                      <td className="py-2" dir="ltr">
                        <Link
                          href={`/app/${params.slug}/inventory/docs/${k.doc_id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {k.number ?? "—"}
                        </Link>
                      </td>
                      <td className="py-2 text-xs text-slate-500">
                        {DOC_KINDS[k.kind as keyof typeof DOC_KINDS] ?? k.kind}
                      </td>
                      <td className="py-2 text-xs text-slate-500">{k.warehouse}</td>
                      <td className="py-2">{q > 0 ? formatQty(q) : "—"}</td>
                      <td className="py-2">{q < 0 ? formatQty(-q) : "—"}</td>
                      <td className="py-2 font-medium">{formatQty(running)}</td>
                      <td className="py-2 text-xs text-slate-500">
                        {formatAmount(k.unit_price)}
                      </td>
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
