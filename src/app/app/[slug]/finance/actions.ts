"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import {
  requireTenant,
  ensurePermission,
  ensureModule,
  type TenantContext,
} from "@/lib/session";
import {
  nextEntryNumber,
  validateLines,
  fiscalYearFor,
  type DraftLine,
} from "@/lib/finance";
import { toGregorian, isoDate } from "@/lib/jalali";

export interface FinanceState {
  error?: string;
  ok?: boolean;
}

/** Every finance action starts here: the panel must be on and the key held. */
async function financeCtx(
  slug: string,
  permission: Parameters<typeof ensurePermission>[1]
): Promise<TenantContext> {
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "finance");
  ensurePermission(ctx, permission);
  return ctx;
}

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}/finance${sub}`);
}

/** Read a Jalali y/m/d triple out of a form and return an ISO date. */
function jalaliField(fd: FormData, prefix: string): string {
  const y = Number(fd.get(`${prefix}y`));
  const m = Number(fd.get(`${prefix}m`));
  const d = Number(fd.get(`${prefix}d`));
  if (!y || !m || !d) return isoDate(new Date());
  return isoDate(toGregorian(y, m, d));
}

/* -------------------------------- حساب‌ها -------------------------------- */

const accountSchema = z.object({
  code: z.string().min(1, "کد حساب را وارد کنید."),
  name: z.string().min(2, "نام حساب را وارد کنید."),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  parentId: z.string().optional(),
  isGroup: z.boolean().default(false),
});

export async function createAccountAction(
  _prev: FinanceState,
  formData: FormData
): Promise<FinanceState> {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.accounts.manage");

  const parsed = accountSchema.safeParse({
    code: String(formData.get("code") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    type: String(formData.get("type") || "asset"),
    parentId: String(formData.get("parentId") || "") || undefined,
    isGroup: formData.get("isGroup") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      const parentId = parsed.data.parentId ?? null;
      let level = 1;
      if (parentId) {
        const [p] = await tx<{ level: number }[]>`
          SELECT level FROM ledger_accounts WHERE id = ${parentId}
        `;
        level = (p?.level ?? 1) + 1;
      }
      await tx`
        INSERT INTO ledger_accounts (code, name, type, parent_id, level, is_group)
        VALUES (${parsed.data.code}, ${parsed.data.name}, ${parsed.data.type},
                ${parentId}, ${level}, ${parsed.data.isGroup})
      `;
    });
  } catch {
    return { error: "حسابی با این کد از قبل وجود دارد." };
  }
  rev(slug, "/accounts");
  return { ok: true };
}

export async function toggleAccountActiveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.accounts.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE ledger_accounts SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug, "/accounts");
}

/* ------------------------------ طرف‌حساب‌ها ------------------------------ */

export async function createPartyAction(
  _prev: FinanceState,
  formData: FormData
): Promise<FinanceState> {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.parties.manage");

  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!code) return { error: "کد طرف‌حساب را وارد کنید." };
  if (name.length < 2) return { error: "نام طرف‌حساب را وارد کنید." };

  const kind = String(formData.get("kind") || "other");
  const accountId = String(formData.get("accountId") || "") || null;

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`
        INSERT INTO parties
          (code, name, kind, national_id, economic_code, phone, address, account_id)
        VALUES (
          ${code}, ${name}, ${kind},
          ${String(formData.get("nationalId") || "") || null},
          ${String(formData.get("economicCode") || "") || null},
          ${String(formData.get("phone") || "") || null},
          ${String(formData.get("address") || "") || null},
          ${accountId}
        )
      `;
    });
  } catch {
    return { error: "طرف‌حسابی با این کد از قبل وجود دارد." };
  }
  rev(slug, "/parties");
  return { ok: true };
}

/* ------------------------------ مراکز هزینه ------------------------------ */

export async function createCostCenterAction(
  _prev: FinanceState,
  formData: FormData
): Promise<FinanceState> {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.costcenters.manage");
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!code || name.length < 2) return { error: "کد و نام مرکز هزینه را وارد کنید." };
  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`INSERT INTO cost_centers (code, name) VALUES (${code}, ${name})`;
    });
  } catch {
    return { error: "مرکز هزینه‌ای با این کد وجود دارد." };
  }
  rev(slug, "/parties");
  return { ok: true };
}

/* ------------------------------ سند حسابداری ----------------------------- */

/** Parse the repeating line inputs (line-account-0, line-debit-0, …). */
function linesFromForm(formData: FormData): DraftLine[] {
  const out: DraftLine[] = [];
  for (let i = 0; i < 40; i++) {
    const accountId = String(formData.get(`line-account-${i}`) || "");
    if (!accountId) continue;
    out.push({
      accountId,
      debit: Number(formData.get(`line-debit-${i}`) || 0) || 0,
      credit: Number(formData.get(`line-credit-${i}`) || 0) || 0,
      description: String(formData.get(`line-desc-${i}`) || "") || null,
      partyId: String(formData.get(`line-party-${i}`) || "") || null,
      costCenterId: String(formData.get(`line-cc-${i}`) || "") || null,
    });
  }
  return out;
}

export async function createEntryAction(
  _prev: FinanceState,
  formData: FormData
): Promise<FinanceState> {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "ledger.manage");

  const description = String(formData.get("description") || "").trim();
  const entryDate = jalaliField(formData, "date");
  const lines = linesFromForm(formData).filter(
    (l) => l.debit > 0 || l.credit > 0
  );

  const invalid = validateLines(lines);
  if (invalid) return { error: invalid };

  let entryId = "";
  try {
    await withTenant(ctx.company.schema, async (tx) => {
      const fy = await fiscalYearFor(tx, entryDate);
      if (fy?.is_closed) {
        throw new Error("سال مالی این تاریخ بسته شده است.");
      }
      const number = await nextEntryNumber(tx);
      const [entry] = await tx<{ id: string }[]>`
        INSERT INTO ledger_entries
          (number, entry_date, description, created_by, fiscal_year_id, status)
        VALUES (${number}, ${entryDate}, ${description || null},
                ${ctx.member.memberId}, ${fy?.id ?? null}, 'draft')
        RETURNING id
      `;
      entryId = entry.id;
      let i = 0;
      for (const l of lines) {
        await tx`
          INSERT INTO ledger_lines
            (entry_id, account_id, debit, credit, description, party_id,
             cost_center_id, sort_order)
          VALUES (${entry.id}, ${l.accountId}, ${l.debit}, ${l.credit},
                  ${l.description ?? null}, ${l.partyId ?? null},
                  ${l.costCenterId ?? null}, ${i++})
        `;
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ثبت سند." };
  }

  rev(slug, "/entries");
  redirect(`/app/${slug}/finance/entries/${entryId}`);
}

/** قطعی کردن سند — after this the voucher is read-only. */
export async function postEntryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.entries.post");
  const id = String(formData.get("entryId"));

  await withTenant(ctx.company.schema, async (tx) => {
    const [entry] = await tx<{ status: string }[]>`
      SELECT status FROM ledger_entries WHERE id = ${id}
    `;
    if (!entry || entry.status !== "draft") return;
    const [sums] = await tx<{ debit: string; credit: string }[]>`
      SELECT COALESCE(sum(debit),0) AS debit, COALESCE(sum(credit),0) AS credit
      FROM ledger_lines WHERE entry_id = ${id}
    `;
    if (Math.abs(Number(sums.debit) - Number(sums.credit)) > 0.009) return;
    await tx`
      UPDATE ledger_entries
      SET status = 'posted', posted_by = ${ctx.member.memberId}, posted_at = now()
      WHERE id = ${id}
    `;
  });
  rev(slug, "/entries");
  revalidatePath(`/app/${slug}/finance/entries/${id}`);
}

/** ابطال سند — a posted voucher is never edited, only voided with a reason. */
export async function voidEntryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.entries.void");
  const id = String(formData.get("entryId"));
  const reason = String(formData.get("reason") || "").trim() || null;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE ledger_entries SET status = 'void', void_reason = ${reason}
      WHERE id = ${id} AND status <> 'void'
    `;
  });
  rev(slug, "/entries");
  revalidatePath(`/app/${slug}/finance/entries/${id}`);
}

export async function deleteEntryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "ledger.manage");
  const id = String(formData.get("entryId"));
  await withTenant(ctx.company.schema, async (tx) => {
    // Only a draft may be deleted; posted vouchers stay for the audit trail.
    await tx`DELETE FROM ledger_entries WHERE id = ${id} AND status = 'draft'`;
  });
  rev(slug, "/entries");
  redirect(`/app/${slug}/finance/entries`);
}

/* ------------------------------- سال مالی ------------------------------- */

export async function createFiscalYearAction(
  _prev: FinanceState,
  formData: FormData
): Promise<FinanceState> {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.periods.manage");
  const title = String(formData.get("title") || "").trim();
  if (title.length < 2) return { error: "عنوان سال مالی را وارد کنید." };
  const start = jalaliField(formData, "start");
  const end = jalaliField(formData, "end");
  if (start >= end) return { error: "تاریخ پایان باید بعد از تاریخ شروع باشد." };

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO fiscal_years (title, start_date, end_date)
      VALUES (${title}, ${start}, ${end})
    `;
  });
  rev(slug, "/periods");
  return { ok: true };
}

export async function setFiscalYearStateAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await financeCtx(slug, "finance.periods.manage");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));

  await withTenant(ctx.company.schema, async (tx) => {
    if (op === "activate") {
      await tx`UPDATE fiscal_years SET is_active = false`;
      await tx`UPDATE fiscal_years SET is_active = true WHERE id = ${id}`;
    } else if (op === "close") {
      await tx`UPDATE fiscal_years SET is_closed = true WHERE id = ${id}`;
    } else if (op === "reopen") {
      await tx`UPDATE fiscal_years SET is_closed = false WHERE id = ${id}`;
    }
  });
  rev(slug, "/periods");
}
