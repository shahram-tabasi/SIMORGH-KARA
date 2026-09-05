import { NextResponse } from "next/server";
import { apiRoute, limitOf, param } from "../../_helpers";
import { ApiError, authenticateApi, requireScope } from "@/lib/api-auth";
import { withTenant } from "@/lib/db";
import { DOC_KINDS, DOC_PERMISSION, nextDocNumber } from "@/lib/inventory";
import type { PermissionKey } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/inventory/docs?status=&kind= — اسناد انبار با ردیف‌ها. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "inventory", "inventory.view", async (tx) => {
    const status = param(req, "status");
    const kind = param(req, "kind");
    const limit = limitOf(req, 200);
    const docs = await tx<{ id: string }[]>`
      SELECT d.id, d.number, d.kind, d.doc_date::text, d.status, d.note,
             w.name AS warehouse, tw.name AS to_warehouse
      FROM stock_docs d
      JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN warehouses tw ON tw.id = d.to_warehouse_id
      WHERE ${status ? tx`d.status = ${status}` : tx`true`}
        AND ${kind ? tx`d.kind = ${kind}` : tx`true`}
      ORDER BY d.doc_date DESC, d.created_at DESC
      LIMIT ${limit}
    `;
    if (docs.length === 0) return [];
    const ids = docs.map((d) => d.id);
    const lines = await tx<{ doc_id: string }[]>`
      SELECT l.doc_id, i.code AS item_code, i.name AS item, i.unit,
             l.qty, l.unit_price, l.note
      FROM stock_doc_lines l
      JOIN items i ON i.id = l.item_id
      WHERE l.doc_id = ANY(${ids})
      ORDER BY l.sort_order
    `;
    return docs.map((d) => ({
      ...d,
      lines: lines.filter((l) => l.doc_id === d.id),
    }));
  });
}

/**
 * POST /api/<slug>/v1/inventory/docs — ثبت سند انبار به‌صورت **پیش‌نویس**.
 *
 *   { "kind": "receipt", "warehouse_code": "W1", "doc_date": "2026-06-25"?,
 *     "note": "…"?, "lines": [ { "item_code": "IT-1001", "qty": 5,
 *                               "unit_price": 120000?, "note": "…"? } ] }
 *
 * سند هرگز مستقیماً تأیید نمی‌شود؛ انباردار باید آن را در پنل تأیید کند تا
 * موجودی تغییر کند. کلید API علاوه بر `api.write` باید مجوز همان نوع سند را
 * هم داشته باشد.
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  try {
    const ctx = await authenticateApi(req, params.slug);
    requireScope(ctx, "api", "api.write");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError("invalid json", 400);

    const kind = String(body.kind || "");
    if (!(kind in DOC_KINDS)) throw new ApiError("unknown document kind", 400);
    requireScope(
      ctx,
      "inventory",
      DOC_PERMISSION[kind as keyof typeof DOC_PERMISSION] as PermissionKey
    );

    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length === 0) throw new ApiError("lines are required", 400);

    const result = await withTenant(ctx.schema, async (tx) => {
      const whCode = String(body.warehouse_code || "");
      const [wh] = await tx<{ id: string }[]>`
        SELECT id FROM warehouses WHERE code = ${whCode} AND is_active = true
      `;
      if (!wh) throw new ApiError(`warehouse '${whCode}' not found`, 400);

      let toWh: string | null = null;
      if (kind === "transfer") {
        const toCode = String(body.to_warehouse_code || "");
        const [w2] = await tx<{ id: string }[]>`
          SELECT id FROM warehouses WHERE code = ${toCode} AND is_active = true
        `;
        if (!w2) throw new ApiError(`to_warehouse '${toCode}' not found`, 400);
        toWh = w2.id;
      }

      const number = await nextDocNumber(tx, kind);
      const docDate =
        typeof body.doc_date === "string" && body.doc_date ? body.doc_date : null;
      const [doc] = await tx<{ id: string }[]>`
        INSERT INTO stock_docs
          (number, kind, doc_date, warehouse_id, to_warehouse_id, note, status)
        VALUES (${number}, ${kind},
                COALESCE(${docDate}::date, current_date),
                ${wh.id}, ${toWh},
                ${typeof body.note === "string" ? body.note : null}, 'draft')
        RETURNING id
      `;

      let i = 0;
      for (const raw of rawLines) {
        const l = raw as Record<string, unknown>;
        const qty = Number(l.qty);
        if (!(qty > 0)) throw new ApiError("each line needs qty > 0", 400);
        const [item] = await tx<{ id: string }[]>`
          SELECT id FROM items WHERE code = ${String(l.item_code || "")}
        `;
        if (!item) throw new ApiError(`item '${String(l.item_code)}' not found`, 400);
        await tx`
          INSERT INTO stock_doc_lines (doc_id, item_id, qty, unit_price, note, sort_order)
          VALUES (${doc.id}, ${item.id}, ${qty},
                  ${Number(l.unit_price) || 0},
                  ${typeof l.note === "string" ? l.note : null}, ${i++})
        `;
      }
      return { id: doc.id, number, kind, status: "draft" };
    });

    return NextResponse.json({ ok: true, data: result }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected error" },
      { status: 500 }
    );
  }
}
