import type { Tx } from "./db";

/** Money formatting — Persian digits, thousands separated, ریال/تومان agnostic. */
export function formatAmount(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "۰";
  return n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

export const ACCOUNT_TYPES = {
  asset: "دارایی",
  liability: "بدهی",
  equity: "سرمایه",
  income: "درآمد",
  expense: "هزینه",
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export const ENTRY_STATUS = {
  draft: "پیش‌نویس",
  posted: "قطعی",
  void: "ابطال‌شده",
} as const;

export const PARTY_KINDS = {
  customer: "مشتری",
  supplier: "تأمین‌کننده",
  contractor: "پیمانکار",
  employee: "کارمند",
  other: "سایر",
} as const;

/** Normal balance side of an account type — used by the trial balance. */
export function isDebitNature(type: string): boolean {
  return type === "asset" || type === "expense";
}

/** Next voucher number for the company (شمارهٔ سند). */
export async function nextEntryNumber(tx: Tx): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT COALESCE(MAX(number), 0) + 1 AS n FROM ledger_entries
  `;
  return row.n;
}

export interface DraftLine {
  accountId: string;
  debit: number;
  credit: number;
  description?: string | null;
  partyId?: string | null;
  costCenterId?: string | null;
}

/** A voucher is only valid when it has ≥2 lines and بدهکار = بستانکار. */
export function validateLines(lines: DraftLine[]): string | null {
  const clean = lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
  if (clean.length < 2) return "سند باید حداقل دو آرتیکل داشته باشد.";
  if (clean.some((l) => l.debit > 0 && l.credit > 0)) {
    return "هر آرتیکل فقط می‌تواند بدهکار یا بستانکار باشد.";
  }
  const debit = clean.reduce((s, l) => s + l.debit, 0);
  const credit = clean.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(debit - credit) > 0.009) {
    return `سند تراز نیست: بدهکار ${formatAmount(debit)} / بستانکار ${formatAmount(credit)}`;
  }
  return null;
}

/** Resolve an account id from its code (used when auto-posting stock docs). */
export async function accountIdByCode(
  tx: Tx,
  code: string
): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE code = ${code} LIMIT 1
  `;
  return row?.id ?? null;
}

/** The fiscal year that contains a date, or the active one. */
export async function fiscalYearFor(
  tx: Tx,
  isoDate: string
): Promise<{ id: string; is_closed: boolean } | null> {
  const [row] = await tx<{ id: string; is_closed: boolean }[]>`
    SELECT id, is_closed FROM fiscal_years
    WHERE ${isoDate}::date BETWEEN start_date AND end_date
    ORDER BY is_active DESC LIMIT 1
  `;
  return row ?? null;
}
