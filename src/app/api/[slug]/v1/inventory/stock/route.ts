import { apiRoute, param } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/inventory/stock?warehouse=<uuid> — موجودی هر کالا در هر انبار. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "inventory", "inventory.view", async (tx) => {
    const warehouse = param(req, "warehouse");
    return tx`
      SELECT w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse,
             i.id AS item_id, i.code AS item_code, i.name AS item, i.unit,
             s.qty, i.min_stock, (s.qty <= i.min_stock) AS below_reorder
      FROM stock_levels s
      JOIN items i ON i.id = s.item_id
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE ${warehouse ? tx`s.warehouse_id = ${warehouse}` : tx`true`}
      ORDER BY w.code, i.code
    `;
  });
}
