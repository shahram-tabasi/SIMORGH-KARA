"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";

export interface TypeState {
  error?: string;
  ok?: boolean;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rev(slug: string) {
  revalidatePath(`/app/${slug}/leave/types`);
  revalidatePath(`/app/${slug}/leave`);
}

/** Create or update a leave type and all of its rule fields. */
export async function saveLeaveTypeAction(
  _prev: TypeState,
  formData: FormData
): Promise<TypeState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.types.manage");

  const id = formData.get("id") ? String(formData.get("id")) : null;
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "نام نوع مرخصی را وارد کنید." };

  const unit = String(formData.get("unit") || "day") === "hour" ? "hour" : "day";
  const paid = formData.get("paid") === "on";
  const deducts = formData.get("deducts_entitlement") === "on";
  const countsHolidays = formData.get("counts_inner_holidays") === "on";
  const requiresAtt = formData.get("requires_attachment") === "on";
  const active = formData.get("is_active") === "on";
  const maxMin = num(formData.get("max_minutes_per_day"));
  const maxMonth = num(formData.get("max_count_per_month"));
  const maxWeek = num(formData.get("max_count_per_week"));
  const maxYear = num(formData.get("max_days_per_year"));
  const levels = Math.max(1, Math.min(5, num(formData.get("approval_levels")) ?? 1));
  const sort = num(formData.get("sort_order")) ?? 100;
  const description = String(formData.get("description") || "").trim();

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      if (id) {
        await tx`
          UPDATE leave_types SET
            name = ${name}, unit = ${unit}, paid = ${paid},
            deducts_entitlement = ${deducts}, counts_inner_holidays = ${countsHolidays},
            requires_attachment = ${requiresAtt}, max_minutes_per_day = ${maxMin},
            max_count_per_month = ${maxMonth}, max_count_per_week = ${maxWeek},
            max_days_per_year = ${maxYear}, approval_levels = ${levels},
            is_active = ${active}, sort_order = ${sort}, description = ${description}
          WHERE id = ${id}
        `;
      } else {
        const code = `custom_${Date.now().toString(36)}`;
        await tx`
          INSERT INTO leave_types
            (code, name, unit, paid, deducts_entitlement, counts_inner_holidays,
             requires_attachment, max_minutes_per_day, max_count_per_month,
             max_count_per_week, max_days_per_year, approval_levels, is_active,
             sort_order, description, is_system)
          VALUES
            (${code}, ${name}, ${unit}, ${paid}, ${deducts}, ${countsHolidays},
             ${requiresAtt}, ${maxMin}, ${maxMonth}, ${maxWeek}, ${maxYear},
             ${levels}, ${active}, ${sort}, ${description}, false)
        `;
      }
    });
  } catch {
    return { error: "خطا در ذخیره نوع مرخصی." };
  }
  rev(slug);
  return { ok: true };
}

export async function toggleLeaveTypeAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.types.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE leave_types SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug);
}

/** Delete a custom (non-system) type that has no requests attached. */
export async function deleteLeaveTypeAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.types.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    const [used] = await tx<{ c: number }[]>`
      SELECT count(*)::int AS c FROM leave_requests WHERE type_id = ${id}
    `;
    if (used.c > 0) return; // keep types that are already in use
    await tx`DELETE FROM leave_types WHERE id = ${id} AND is_system = false`;
  });
  rev(slug);
}
