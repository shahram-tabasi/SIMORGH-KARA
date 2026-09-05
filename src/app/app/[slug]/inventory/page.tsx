import Link from "next/link";
import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatQty } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";
import { toFaDigits } from "@/lib/jalali";

interface StockRow {
  item_id: string;
  code: string;
  name: string;
  unit: string;
  min_stock: string;
  last_price: string;
  warehouse: string;
  warehouse_id: string;
  qty: string;
}

async function load(schema: string, warehouseId: string | null) {
  return withTenant(schema, async (tx) => {
    const stock = await tx<StockRow[]>`
      SELECT s.item_id, i.code, i.name, i.unit, i.min_stock, i.last_price,
             w.name AS warehouse, w.id AS warehouse_id, s.qty
      FROM stock_levels s
      JOIN items i ON i.id = s.item_id
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE ${warehouseId ? tx`s.warehouse_id = ${warehouseId}` : tx`true`}
      ORDER BY i.code
    `;
    const warehouses = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM warehouses WHERE is_active = true ORDER BY code
    `;
    const [counts] = await tx<
      { items: number; drafts: number; requests: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM items WHERE is_active = true) AS items,
        (SELECT count(*)::int FROM stock_docs WHERE status = 'draft') AS drafts,
        (SELECT count(*)::int FROM stock_requests WHERE status = 'pending') AS requests
    `;
    return { stock, warehouses, counts };
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

export default async function InventoryHome({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { w?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "inventory");
  ensurePermission(ctx, "inventory.view");
  const warehouseId = searchParams.w ?? null;
  const { stock, warehouses, counts } = await load(ctx.company.schema, warehouseId);
  const base = `/app/${params.slug}/inventory`;

  const totalValue = stock.reduce(
    (s, r) => s + Number(r.qty) * Number(r.last_price),
    0
  );
  const low = stock.filter((r) => Number(r.qty) <= Number(r.min_stock));

  return (
    <>
      <PageHeader
        title="انبار — موجودی کالا"
        description="موجودی زندهٔ هر کالا در هر انبار، بر پایهٔ اسناد تأییدشده"
        action={
          <Link href={`${base}/docs/new`} className="btn-primary">
            ＋ سند انبار
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="کالاهای فعال" value={toFaDigits(counts.items)} />
        <Kpi label="ارزش موجودی" value={formatAmount(totalValue)} hint="بر مبنای آخرین قیمت" />
        <Kpi label="اسناد پیش‌نویس" value={toFaDigits(counts.drafts)} hint="در انتظار تأیید" />
        <Kpi
          label="کالای زیر نقطهٔ سفارش"
          value={toFaDigits(low.length)}
          hint={low.length ? "نیاز به تأمین" : "وضعیت مطلوب"}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={base}
          className={`badge ${!warehouseId ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          همهٔ انبارها
        </Link>
        {warehouses.map((w) => (
          <Link
            key={w.id}
            href={`${base}?w=${w.id}`}
            className={`badge ${
              warehouseId === w.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {w.name}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {stock.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            هنوز موجودی ثبت نشده است. با «سند انبار → رسید ورود» شروع کنید.
          </div>
        ) : (
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">کد</th>
                <th className="pb-2">کالا</th>
                <th className="pb-2">انبار</th>
                <th className="pb-2">موجودی</th>
                <th className="pb-2">واحد</th>
                <th className="pb-2">نقطهٔ سفارش</th>
                <th className="pb-2">ارزش</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((r) => {
                const qty = Number(r.qty);
                const isLow = qty <= Number(r.min_stock);
                return (
                  <tr
                    key={`${r.warehouse_id}:${r.item_id}`}
                    className={`border-t border-slate-100 ${isLow ? "bg-amber-50" : ""}`}
                  >
                    <td className="py-2" dir="ltr">
                      {r.code}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`${base}/reports?item=${r.item_id}`}
                        className="text-brand-600 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-slate-500">{r.warehouse}</td>
                    <td className={`py-2 font-medium ${isLow ? "text-amber-700" : ""}`}>
                      {formatQty(qty)}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{r.unit}</td>
                    <td className="py-2 text-xs text-slate-500">{formatQty(r.min_stock)}</td>
                    <td className="py-2">{formatAmount(qty * Number(r.last_price))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
