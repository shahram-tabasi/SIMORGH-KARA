"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireHolding } from "@/lib/session";
import { provisionCompany } from "@/lib/provision";

const schema = z.object({
  name: z.string().min(2, "نام بخش را وارد کنید."),
  maxUsers: z.coerce.number().int().min(1).max(100000).default(25),
  adminName: z.string().min(2, "نام مدیر بخش را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر بخش نامعتبر است."),
  adminPassword: z.string().min(6, "رمز عبور حداقل ۶ کاراکتر باشد."),
});

export interface HoldingFormState {
  error?: string;
}

/** Holding admin provisions a new section-company under their holding. */
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

  try {
    await provisionCompany({ ...parsed.data, holdingId: ctx.holding.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ساخت بخش." };
  }

  revalidatePath("/holding");
  redirect("/holding");
}
