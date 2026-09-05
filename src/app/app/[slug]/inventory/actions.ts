"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenant, type Tx } from "@/lib/db";
import {
  requireTenant,
  ensurePermission,
  ensureModule,
  hasModule,
  type TenantContext,
} from "@/lib/session";
import {
  DOC_PERMISSION,
  DOC_KINDS,
  isOutgoing,
  nextDocNumber,
  nextRequestNumber,
  checkStockAvailable,
} from "@/lib/inventory";
import { accountIdByCode, nextEntryNumber, fiscalYearFor } from "@/lib/finance";
import { INVENTORY_ACCOUNT_CODE, INVENTORY_COUNTERPART } from "@/lib/coa";
import { toGregorian, isoDate } from "@/lib/jalali";
import type { PermissionKey } from "@/lib/rbac";

export interface InventoryState {
  error?: string;
  ok?: boolean;
}

async function invCtx(
  slug: string,
  permission: PermissionKey
): Promise<TenantContext> {
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "inventory");
  ensurePermission(ctx, permission);
  return ctx;
}

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}/inventory${sub}`);
}

function jalaliField(fd: FormData, prefix: string): string {
  const y = Number(fd.get(`${prefix}y`));
  const m = Number(fd.get(`${prefix}m`));
  const d = Number(fd.get(`${prefix}d`));
  if (!y || !m || !d) return isoDate(new Date());
  return isoDate(toGregorian(y, m, d));
}

/* -------------------------------- انبارها -------------------------------- */

export async function createWarehouseAction(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.warehouses.manage");
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!code || name.length < 2) return { error: "کد و نام انبار را وارد کنید." };

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`
        INSERT INTO warehouses (code, name, location, manager_id)
        VALUES (${code}, ${name},
                ${String(formData.get("location") || "") || null},
                ${String(formData.get("managerId") || "") || null})
      `;
    });
  } catch {
    return { error: "انباری با این کد از قبل وجود دارد." };
  }
  rev(slug, "/warehouses");
  return { ok: true };
}

export async function toggleWarehouseActiveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.warehouses.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE warehouses SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug, "/warehouses");
}

/* --------------------------------- کالاها -------------------------------- */

export async function createItemAction(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.items.manage");
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!code || name.length < 2) return { error: "کد و نام کالا را وارد کنید." };

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`
        INSERT INTO items
          (code, name, category_id, unit, barcode, min_stock, max_stock,
           last_price, description)
        VALUES (
          ${code}, ${name},
          ${String(formData.get("categoryId") || "") || null},
          ${String(formData.get("unit") || "عدد")},
          ${String(formData.get("barcode") || "") || null},
          ${Number(formData.get("minStock") || 0) || 0},
          ${Number(formData.get("maxStock") || 0) || null},
          ${Number(formData.get("lastPrice") || 0) || 0},
          ${String(formData.get("description") || "") || null}
        )
      `;
    });
  } catch {
    return { error: "کالایی با این کد از قبل وجود دارد." };
  }
  rev(slug, "/items");
  return { ok: true };
}

export async function createCategoryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.items.manage");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`INSERT INTO item_categories (name) VALUES (${name})`;
  });
  rev(slug, "/items");
}

export async function toggleItemActiveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.items.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE items SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug, "/items");
}

/* ----------------------------- اسناد انبار ------------------------------ */

interface DocLine {
  itemId: string;
  qty: number;
  unitPrice: number;
  note: string | null;
}

function docLinesFromForm(formData: FormData): DocLine[] {
  const out: DocLine[] = [];
  for (let i = 0; i < 40; i++) {
    const itemId = String(formData.get(`line-item-${i}`) || "");
    const qty = Number(formData.get(`line-qty-${i}`) || 0);
    if (!itemId || !(qty > 0)) continue;
    out.push({
      itemId,
      qty,
      unitPrice: Number(formData.get(`line-price-${i}`) || 0) || 0,
      note: String(formData.get(`line-note-${i}`) || "") || null,
    });
  }
  return out;
}

export async function createStockDocAction(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const slug = String(formData.get("slug"));
  const kind = String(formData.get("kind"));
  if (!(kind in DOC_KINDS)) return { error: "نوع سند نامعتبر است." };
  const ctx = await invCtx(
    slug,
    DOC_PERMISSION[kind as keyof typeof DOC_PERMISSION] as PermissionKey
  );

  const warehouseId = String(formData.get("warehouseId") || "");
  if (!warehouseId) return { error: "انبار را انتخاب کنید." };
  const toWarehouseId = String(formData.get("toWarehouseId") || "") || null;
  if (kind === "transfer" && !toWarehouseId) {
    return { error: "انبار مقصد را انتخاب کنید." };
  }
  if (kind === "transfer" && toWarehouseId === warehouseId) {
    return { error: "انبار مبدأ و مقصد نمی‌توانند یکی باشند." };
  }

  const lines = docLinesFromForm(formData);
  if (lines.length === 0) return { error: "حداقل یک ردیف کالا با مقدار معتبر لازم است." };

  const docDate = jalaliField(formData, "date");
  let docId = "";
  await withTenant(ctx.company.schema, async (tx) => {
    const number = await nextDocNumber(tx, kind);
    const [doc] = await tx<{ id: string }[]>`
      INSERT INTO stock_docs
        (number, kind, doc_date, warehouse_id, to_warehouse_id, party_id,
         member_id, note, created_by, status)
      VALUES (
        ${number}, ${kind}, ${docDate}, ${warehouseId}, ${toWarehouseId},
        ${String(formData.get("partyId") || "") || null},
        ${String(formData.get("memberId") || "") || null},
        ${String(formData.get("note") || "") || null},
        ${ctx.member.memberId}, 'draft'
      )
      RETURNING id
    `;
    docId = doc.id;
    let i = 0;
    for (const l of lines) {
      await tx`
        INSERT INTO stock_doc_lines (doc_id, item_id, qty, unit_price, note, sort_order)
        VALUES (${doc.id}, ${l.itemId}, ${l.qty}, ${l.unitPrice}, ${l.note}, ${i++})
      `;
    }
  });

  rev(slug, "/docs");
  redirect(`/app/${slug}/inventory/docs/${docId}`);
}

/**
 * Post the accounting side of an approved stock document. Silently skipped when
 * the company does not have the finance panel or the accounts are missing —
 * انبار بدون مالی هم کار می‌کند.
 */
async function postStockDocToLedger(
  tx: Tx,
  ctx: TenantContext,
  doc: { id: string; kind: string; doc_date: string; number: number | null },
  value: number
): Promise<void> {
  if (!hasModule(ctx, "finance")) return;
  if (doc.kind === "transfer" || value <= 0) return;

  const counterpart =
    INVENTORY_COUNTERPART[doc.kind as keyof typeof INVENTORY_COUNTERPART];
  if (!counterpart) return;

  const inventoryAccount = await accountIdByCode(tx, INVENTORY_ACCOUNT_CODE);
  const counterAccount = await accountIdByCode(tx, counterpart);
  if (!inventoryAccount || !counterAccount) return;

  // Incoming goods increase the inventory asset; outgoing goods release it.
  const incoming = !isOutgoing(doc.kind);
  const debitAccount = incoming ? inventoryAccount : counterAccount;
  const creditAccount = incoming ? counterAccount : inventoryAccount;

  const fy = await fiscalYearFor(tx, doc.doc_date);
  if (fy?.is_closed) return;

  const number = await nextEntryNumber(tx);
  const [entry] = await tx<{ id: string }[]>`
    INSERT INTO ledger_entries
      (number, entry_date, description, created_by, fiscal_year_id, status,
       ref_kind, ref_id, posted_by, posted_at)
    VALUES (
      ${number}, ${doc.doc_date},
      ${`بابت ${DOC_KINDS[doc.kind as keyof typeof DOC_KINDS]} شمارهٔ ${doc.number ?? "—"}`},
      ${ctx.member.memberId}, ${fy?.id ?? null}, 'posted', 'stock_doc', ${doc.id},
      ${ctx.member.memberId}, now()
    )
    RETURNING id
  `;
  await tx`
    INSERT INTO ledger_lines (entry_id, account_id, debit, credit, sort_order)
    VALUES (${entry.id}, ${debitAccount}, ${value}, 0, 0)
  `;
  await tx`
    INSERT INTO ledger_lines (entry_id, account_id, debit, credit, sort_order)
    VALUES (${entry.id}, ${creditAccount}, 0, ${value}, 1)
  `;
  await tx`
    UPDATE stock_docs SET ledger_entry_id = ${entry.id} WHERE id = ${doc.id}
  `;
}

export async function approveStockDocAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.docs.approve");
  const id = String(formData.get("docId"));

  const error = await withTenant(ctx.company.schema, async (tx) => {
    const [doc] = await tx<
      {
        id: string;
        kind: string;
        status: string;
        warehouse_id: string;
        doc_date: string;
        number: number | null;
      }[]
    >`
      SELECT id, kind, status, warehouse_id, doc_date::text, number
      FROM stock_docs WHERE id = ${id}
    `;
    if (!doc || doc.status !== "draft") return null;

    const lines = await tx<{ item_id: string; qty: string; unit_price: string }[]>`
      SELECT item_id, qty, unit_price FROM stock_doc_lines WHERE doc_id = ${id}
    `;
    if (lines.length === 0) return "سند بدون ردیف کالا قابل تأیید نیست.";

    // Never let an approval drive a warehouse negative.
    if (isOutgoing(doc.kind)) {
      const shortage = await checkStockAvailable(
        tx,
        doc.warehouse_id,
        lines.map((l) => ({ itemId: l.item_id, qty: Number(l.qty) }))
      );
      if (shortage) return shortage;
    }

    await tx`
      UPDATE stock_docs
      SET status = 'approved', approved_by = ${ctx.member.memberId}, approved_at = now()
      WHERE id = ${id}
    `;
    // Keep the item's last known price for valuation.
    for (const l of lines) {
      if (Number(l.unit_price) > 0) {
        await tx`
          UPDATE items SET last_price = ${Number(l.unit_price)} WHERE id = ${l.item_id}
        `;
      }
    }
    const value = lines.reduce(
      (s, l) => s + Number(l.qty) * Number(l.unit_price),
      0
    );
    await postStockDocToLedger(tx, ctx, doc, value);
    return null;
  });

  rev(slug, "/docs");
  revalidatePath(`/app/${slug}/inventory/docs/${id}`);
  // A shortage is ordinary business feedback, not a crash: send the keeper back
  // to the document with the reason shown inline.
  if (error) {
    redirect(
      `/app/${slug}/inventory/docs/${id}?error=${encodeURIComponent(error)}`
    );
  }
}

export async function voidStockDocAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.docs.approve");
  const id = String(formData.get("docId"));
  await withTenant(ctx.company.schema, async (tx) => {
    const [doc] = await tx<{ ledger_entry_id: string | null }[]>`
      SELECT ledger_entry_id FROM stock_docs WHERE id = ${id}
    `;
    await tx`UPDATE stock_docs SET status = 'void' WHERE id = ${id}`;
    if (doc?.ledger_entry_id) {
      await tx`
        UPDATE ledger_entries
        SET status = 'void', void_reason = 'ابطال سند انبار مرتبط'
        WHERE id = ${doc.ledger_entry_id}
      `;
    }
  });
  rev(slug, "/docs");
  revalidatePath(`/app/${slug}/inventory/docs/${id}`);
}

export async function deleteStockDocAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "inventory");
  const id = String(formData.get("docId"));
  await withTenant(ctx.company.schema, async (tx) => {
    // The creator may drop their own draft; approvers may drop any draft.
    const [doc] = await tx<{ created_by: string | null; status: string }[]>`
      SELECT created_by, status FROM stock_docs WHERE id = ${id}
    `;
    if (!doc || doc.status !== "draft") return;
    const isOwner = doc.created_by === ctx.member.memberId;
    if (!isOwner && !ctx.member.permissions.has("inventory.docs.approve")) return;
    await tx`DELETE FROM stock_docs WHERE id = ${id}`;
  });
  rev(slug, "/docs");
  redirect(`/app/${slug}/inventory/docs`);
}

/* ----------------------------- درخواست کالا ------------------------------ */

export async function createStockRequestAction(
  _prev: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.request");
  const lines = docLinesFromForm(formData);
  if (lines.length === 0) return { error: "حداقل یک ردیف کالا با مقدار معتبر لازم است." };

  await withTenant(ctx.company.schema, async (tx) => {
    const number = await nextRequestNumber(tx);
    const [req] = await tx<{ id: string }[]>`
      INSERT INTO stock_requests
        (number, requester_id, warehouse_id, needed_date, note)
      VALUES (
        ${number}, ${ctx.member.memberId},
        ${String(formData.get("warehouseId") || "") || null},
        ${jalaliField(formData, "date")},
        ${String(formData.get("note") || "") || null}
      )
      RETURNING id
    `;
    for (const l of lines) {
      await tx`
        INSERT INTO stock_request_lines (request_id, item_id, qty, note)
        VALUES (${req.id}, ${l.itemId}, ${l.qty}, ${l.note})
      `;
    }
  });
  rev(slug, "/requests");
  return { ok: true };
}

export async function decideStockRequestAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.request.approve");
  const id = String(formData.get("requestId"));
  const decision = String(formData.get("decision"));
  if (decision !== "approved" && decision !== "rejected") return;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE stock_requests
      SET status = ${decision}, decided_by = ${ctx.member.memberId},
          decided_at = now(),
          decision_note = ${String(formData.get("note") || "") || null}
      WHERE id = ${id} AND status = 'pending'
    `;
  });
  rev(slug, "/requests");
}

/**
 * Turn an approved request into a draft حواله خروج, so the warehouse keeper only
 * has to check it and approve — the request and the document stay linked.
 */
export async function fulfillStockRequestAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug"));
  const ctx = await invCtx(slug, "inventory.issue");
  const id = String(formData.get("requestId"));
  let docId = "";

  await withTenant(ctx.company.schema, async (tx) => {
    const [req] = await tx<
      {
        id: string;
        status: string;
        warehouse_id: string | null;
        requester_id: string;
        number: number | null;
      }[]
    >`
      SELECT id, status, warehouse_id, requester_id, number
      FROM stock_requests WHERE id = ${id}
    `;
    if (!req || req.status !== "approved" || !req.warehouse_id) return;

    const lines = await tx<{ item_id: string; qty: string; approved_qty: string | null }[]>`
      SELECT item_id, qty, approved_qty FROM stock_request_lines WHERE request_id = ${id}
    `;
    if (lines.length === 0) return;

    const number = await nextDocNumber(tx, "issue");
    const [doc] = await tx<{ id: string }[]>`
      INSERT INTO stock_docs
        (number, kind, warehouse_id, member_id, request_id, note, created_by, status)
      VALUES (${number}, 'issue', ${req.warehouse_id}, ${req.requester_id}, ${req.id},
              ${`بابت درخواست کالا شمارهٔ ${req.number ?? "—"}`},
              ${ctx.member.memberId}, 'draft')
      RETURNING id
    `;
    docId = doc.id;
    let i = 0;
    for (const l of lines) {
      const [item] = await tx<{ last_price: string }[]>`
        SELECT last_price FROM items WHERE id = ${l.item_id}
      `;
      await tx`
        INSERT INTO stock_doc_lines (doc_id, item_id, qty, unit_price, sort_order)
        VALUES (${doc.id}, ${l.item_id},
                ${Number(l.approved_qty ?? l.qty)},
                ${Number(item?.last_price ?? 0)}, ${i++})
      `;
    }
    await tx`UPDATE stock_requests SET status = 'fulfilled' WHERE id = ${id}`;
  });

  rev(slug, "/requests");
  if (docId) redirect(`/app/${slug}/inventory/docs/${docId}`);
}
