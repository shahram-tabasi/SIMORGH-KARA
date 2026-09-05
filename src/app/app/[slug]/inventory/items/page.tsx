import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatQty } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";
import { ItemForm } from "./ItemForm";
import { toggleItemActiveAction, createCategoryAction } from "../actions";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const items = await tx<
      {
        id: string;
        code: string;
        name: string;
        unit: string;
        category: string | null;
        min_stock: string;
        last_price: string;
        is_active: boolean;
        qty: string;
      }[]
    >`
      SELECT i.id, i.code, i.name, i.unit, c.name AS category,
             i.min_stock, i.last_price, i.is_active,
             COALESCE((SELECT sum(s.qty) FROM stock_levels s WHERE s.item_id = i.id), 0) AS qty
      FROM items i
      LEFT JOIN item_categories c ON c.id = i.category_id
      ORDER BY i.code
    `;
    const categories = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM item_categories ORDER BY name
    `;
    return { items, categories };
  });
}

export default async function ItemsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "inventory", "inventory.view");
  const canManage = ctx.member.permissions.has("inventory.items.manage");
  const { items, categories } = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="کالاها"
        description="فهرست کالاها، گروه‌بندی، واحد شمارش و نقطهٔ سفارش"
      />

      {canManage && (
        <>
          <div className="mb-4">
            <ItemForm slug={params.slug} categories={categories} />
          </div>
          <form action={createCategoryAction} className="card mb-6 flex flex-wrap items-end gap-3">
            <input type="hidden" name="slug" value={params.slug} />
            <div>
              <label className="label">گروه کالای جدید</label>
              <input name="name" className="input" placeholder="مثلاً روانکار" />
            </div>
            <button className="btn-ghost">افزودن گروه</button>
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <span key={c.id} className="badge bg-slate-100 text-slate-600">
                  {c.name}
                </span>
              ))}
            </div>
          </form>
        </>
      )}

      <div className="card overflow-x-auto">
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            هنوز کالایی تعریف نشده است.
          </div>
        ) : (
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">کد</th>
                <th className="pb-2">نام کالا</th>
                <th className="pb-2">گروه</th>
                <th className="pb-2">واحد</th>
                <th className="pb-2">موجودی کل</th>
                <th className="pb-2">نقطهٔ سفارش</th>
                <th className="pb-2">آخرین قیمت</th>
                {canManage && <th className="pb-2">وضعیت</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {i.code}
                  </td>
                  <td className="py-2">
                    {i.name}
                    {!i.is_active && (
                      <span className="badge mr-2 bg-slate-100 text-slate-500">غیرفعال</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-500">{i.category ?? "—"}</td>
                  <td className="py-2 text-xs text-slate-500">{i.unit}</td>
                  <td className="py-2 font-medium">{formatQty(i.qty)}</td>
                  <td className="py-2 text-xs text-slate-500">{formatQty(i.min_stock)}</td>
                  <td className="py-2">{formatAmount(i.last_price)}</td>
                  {canManage && (
                    <td className="py-2">
                      <form action={toggleItemActiveAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={i.id} />
                        <button className="text-xs text-brand-600 hover:underline">
                          {i.is_active ? "غیرفعال کن" : "فعال کن"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
