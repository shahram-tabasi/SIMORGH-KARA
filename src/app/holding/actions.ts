"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireHolding } from "@/lib/session";
import { sql } from "@/lib/db";
import { provisionCompany } from "@/lib/provision";

const schema = z.object({
  name: z.string().min(2, "نام شرکت را وارد کنید."),
  maxUsers: z.coerce.number().int().min(1).max(100000).default(25),
  adminName: z.string().min(2, "نام مدیر شرکت را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر شرکت نامعتبر است."),
  adminPassword: z.string().min(6, "رمز عبور حداقل ۶ کاراکتر باشد."),
});

export interface HoldingFormState {
  error?: string;
}

/** Holding admin provisions a new company under their holding (within quota). */
export async function createHoldingCompanyAction(
  _prev: HoldingFormState,
  formData: FormData
): Promise<HoldingFormState> {
  const ctx = await requireHolding();

  const parsed = schema.safeParse({
    name: formData.get("name"),
    maxUsers: formData.get("maxUsers") || 25,
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Enforce the company quota set by the platform admin.
  const [{ max_companies }] = await sql<{ max_companies: number }[]>`
    SELECT max_companies FROM platform.holdings WHERE id = ${ctx.holding.id}
  `;
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM platform.companies WHERE holding_id = ${ctx.holding.id}
  `;
  if (n >= max_companies) {
    return {
      error: `سقف شرکت‌های مجاز (${max_companies}) پر شده است؛ برای افزایش با مدیر سامانه هماهنگ کنید.`,
    };
  }

  try {
    await provisionCompany({ ...parsed.data, holdingId: ctx.holding.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ساخت شرکت." };
  }

  revalidatePath("/holding");
  redirect("/holding");
}
