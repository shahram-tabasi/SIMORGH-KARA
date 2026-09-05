import type { Tx } from "./db";

export const DOC_KINDS = {
  receipt: "رسید ورود",
  issue: "حواله خروج",
  transfer: "انتقال بین انبار",
  adjust_in: "اصلاح (افزایش)",
  adjust_out: "اصلاح (کاهش)",
} as const;

export type DocKind = keyof typeof DOC_KINDS;

/** Permission required to create each kind of stock document. */
export const DOC_PERMISSION = {
  receipt: "inventory.receipt",
  issue: "inventory.issue",
  transfer: "inventory.transfer",
  adjust_in: "inventory.adjust",
  adjust_out: "inventory.adjust",
} as const;

export const DOC_STATUS = {
  draft: "پیش‌نویس",
  approved: "تأییدشده",
  void: "ابطال‌شده",
} as const;

export const REQUEST_STATUS = {
  pending: "در انتظار تأیید",
  approved: "تأییدشده",
  rejected: "رد شده",
  fulfilled: "تحویل شد",
} as const;

/** Document kinds that take stock *out* of `warehouse_id`. */
export function isOutgoing(kind: string): boolean {
  return kind === "issue" || kind === "transfer" || kind === "adjust_out";
}

export const UNITS = [
  "عدد",
  "کیلوگرم",
  "تن",
  "متر",
  "متر مربع",
  "متر مکعب",
  "لیتر",
  "بسته",
  "کارتن",
  "حلقه",
  "جفت",
  "دستگاه",
];

export function formatQty(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "۰";
  return n.toLocaleString("fa-IR", { maximumFractionDigits: 3 });
}

export async function nextDocNumber(tx: Tx, kind: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT COALESCE(MAX(number), 0) + 1 AS n FROM stock_docs WHERE kind = ${kind}
  `;
  return row.n;
}

export async function nextRequestNumber(tx: Tx): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT COALESCE(MAX(number), 0) + 1 AS n FROM stock_requests
  `;
  return row.n;
}

/** Current quantity of an item in a warehouse (approved documents only). */
export async function stockOf(
  tx: Tx,
  warehouseId: string,
  itemId: string
): Promise<number> {
  const [row] = await tx<{ qty: string | null }[]>`
    SELECT qty FROM stock_levels
    WHERE warehouse_id = ${warehouseId} AND item_id = ${itemId}
  `;
  return Number(row?.qty ?? 0);
}

/**
 * Refuse to approve a document that would push a warehouse negative — the
 * warehouse keeper must fix the numbers instead of hiding a shortage.
 */
export async function checkStockAvailable(
  tx: Tx,
  warehouseId: string,
  lines: { itemId: string; qty: number }[]
): Promise<string | null> {
  for (const l of lines) {
    const have = await stockOf(tx, warehouseId, l.itemId);
    if (have < l.qty) {
      const [item] = await tx<{ name: string; unit: string }[]>`
        SELECT name, unit FROM items WHERE id = ${l.itemId}
      `;
      return `موجودی «${item?.name ?? "کالا"}» کافی نیست (موجود: ${formatQty(
        have
      )} ${item?.unit ?? ""}، درخواستی: ${formatQty(l.qty)}).`;
    }
  }
  return null;
}
