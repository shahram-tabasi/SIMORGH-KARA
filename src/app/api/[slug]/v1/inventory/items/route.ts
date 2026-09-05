import { apiRoute, limitOf } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/inventory/items — کالاها با موجودی کل. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "inventory", "inventory.view", async (tx) => {
    const limit = limitOf(req, 500);
    return tx`
      SELECT i.id, i.code, i.name, i.unit, i.barcode, i.min_stock, i.last_price,
             i.is_active, c.name AS category,
             COALESCE((SELECT sum(s.qty) FROM stock_levels s WHERE s.item_id = i.id), 0) AS qty
      FROM items i
      LEFT JOIN item_categories c ON c.id = i.category_id
      ORDER BY i.code LIMIT ${limit}
    `;
  });
}
