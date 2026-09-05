import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { formatQty } from "@/lib/inventory";
import { WarehouseForm } from "./WarehouseForm";
import { toggleWarehouseActiveAction } from "../actions";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const warehouses = await tx<
      {
        id: string;
        code: string;
        name: string;
        location: string | null;
        manager: string | null;
        is_active: boolean;
        items: number;
        total_qty: string;
      }[]
    >`
      SELECT w.id, w.code, w.name, w.location, w.is_active,
             m.full_name AS manager,
             (SELECT count(*)::int FROM stock_levels s
              WHERE s.warehouse_id = w.id AND s.qty <> 0) AS items,
             COALESCE((SELECT sum(s.qty) FROM stock_levels s
                       WHERE s.warehouse_id = w.id), 0) AS total_qty
      FROM warehouses w
      LEFT JOIN members m ON m.id = w.manager_id
      ORDER BY w.code
    `;
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    return { warehouses, members };
  });
}

export default async function WarehousesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "inventory");
  ensurePermission(ctx, "inventory.view");
  const canManage = ctx.member.permissions.has("inventory.warehouses.manage");
  const { warehouses, members } = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="انبارها"
        description="هر انبار موجودی مستقل دارد؛ انتقال بین انبارها با سند «انتقال» انجام می‌شود"
      />

      {canManage && (
        <div className="mb-6">
          <WarehouseForm slug={params.slug} members={members} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {warehouses.map((w) => (
          <div key={w.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{w.name}</span>
                  <span className="badge bg-slate-100 text-slate-500" dir="ltr">
                    {w.code}
                  </span>
                  {!w.is_active && (
                    <span className="badge bg-red-100 text-red-700">غیرفعال</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {w.location ?? "—"} · انباردار: {w.manager ?? "تعیین‌نشده"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {w.items} قلم کالا · مجموع مقدار {formatQty(w.total_qty)}
                </div>
              </div>
              {canManage && (
                <form action={toggleWarehouseActiveAction}>
                  <input type="hidden" name="slug" value={params.slug} />
                  <input type="hidden" name="id" value={w.id} />
                  <button className="text-xs text-brand-600 hover:underline">
                    {w.is_active ? "غیرفعال کن" : "فعال کن"}
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
