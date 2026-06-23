"use server";

import { revalidatePath } from "next/cache";
import { sql, withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { loadBalance } from "@/lib/leave-balance";

/** Max days that may be carried into the next year (ماده ۶۶ قانون کار). */
const MAX_CARRYOVER = 9;

function rev(slug: string) {
  revalidatePath(`/app/${slug}/leave/ledger`);
  revalidatePath(`/app/${slug}/leave`);
}

/** Add a manual ledger entry: buy-back, adjustment, or carry-in. */
export async function addLedgerEntryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.ledger.manage");

  const memberId = String(formData.get("memberId"));
  const jyear = Number(formData.get("jyear"));
  const kind = String(formData.get("kind"));
  const rawDays = Number(formData.get("days"));
  const note = String(formData.get("note") || "").trim() || null;
  if (!memberId || !jyear || !Number.isFinite(rawDays) || rawDays === 0) return;
  if (!["carry_in", "buyback", "forfeit", "adjust"].includes(kind)) return;

  // Normalize the sign by kind: carry_in adds, buyback/forfeit subtract,
  // adjust keeps the entered sign.
  const mag = Math.abs(rawDays);
  const days =
    kind === "carry_in" ? mag : kind === "adjust" ? rawDays : -mag;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO leave_ledger (member_id, jyear, kind, days, note, created_by)
      VALUES (${memberId}, ${jyear}, ${kind}, ${days}, ${note}, ${ctx.member.memberId})
    `;
  });
  rev(slug);
}

export async function deleteLedgerEntryAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.ledger.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM leave_ledger WHERE id = ${id}`;
  });
  rev(slug);
}

/**
 * Year-end close for a Jalali year: carry at most 9 remaining days into the
 * next year and forfeit the rest (ماده ۶۶). Idempotent per member — skips
 * anyone who already has a carry-in for the next year.
 */
export async function runYearEndAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.ledger.manage");
  const jyear = Number(formData.get("jyear"));
  if (!jyear) return;

  const members = await withTenant(ctx.company.schema, async (tx) =>
    tx<{ id: string }[]>`SELECT id FROM members WHERE status = 'active'`
  );

  for (const m of members) {
    // Skip members already closed for this year.
    const [done] = await sql.unsafe(
      `SELECT 1 FROM "${ctx.company.schema}".leave_ledger
       WHERE member_id = $1 AND jyear = $2 AND kind = 'carry_in'
         AND note = $3 LIMIT 1`,
      [m.id, jyear + 1, `انتقال از سال ${jyear}`]
    );
    if (done) continue;

    const bal = await loadBalance(ctx.company.schema, m.id, jyear);
    const remaining = Math.max(0, bal.remaining);
    const carry = Math.min(MAX_CARRYOVER, remaining);
    const forfeit = Math.max(0, remaining - MAX_CARRYOVER);

    await withTenant(ctx.company.schema, async (tx) => {
      if (carry > 0) {
        await tx`
          INSERT INTO leave_ledger (member_id, jyear, kind, days, note, created_by)
          VALUES (${m.id}, ${jyear + 1}, 'carry_in', ${carry},
                  ${`انتقال از سال ${jyear}`}, ${ctx.member.memberId})
        `;
      }
      if (forfeit > 0) {
        await tx`
          INSERT INTO leave_ledger (member_id, jyear, kind, days, note, created_by)
          VALUES (${m.id}, ${jyear}, 'forfeit', ${-forfeit},
                  ${`سوخت پایان سال ${jyear}`}, ${ctx.member.memberId})
        `;
      }
    });
  }
  rev(slug);
}
