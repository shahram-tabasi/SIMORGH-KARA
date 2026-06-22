"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/session";
import { provisionCompany } from "@/lib/provision";

const newCompanySchema = z.object({
  name: z.string().min(2, "نام شرکت حداقل ۲ کاراکتر باشد."),
  plan: z.string().default("standard"),
  maxUsers: z.coerce.number().int().min(1).max(100000).default(10),
  adminName: z.string().min(2, "نام مدیر را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر نامعتبر است."),
  adminPassword: z.string().min(6, "رمز عبور حداقل ۶ کاراکتر باشد."),
});

export interface CompanyFormState {
  error?: string;
}

export async function createCompanyAction(
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  await requirePlatformAdmin();

  const parsed = newCompanySchema.safeParse({
    name: formData.get("name"),
    plan: formData.get("plan") || "standard",
    maxUsers: formData.get("maxUsers") || 10,
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await provisionCompany(parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ساخت شرکت." };
  }

  revalidatePath("/admin/companies");
  redirect("/admin/companies");
}

export async function setCompanyStatusAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["active", "suspended"].includes(status)) return;
  await sql`
    UPDATE platform.companies SET status = ${status} WHERE id = ${id}
  `;
  revalidatePath("/admin/companies");
}

export async function updateCompanyAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const plan = String(formData.get("plan") || "standard");
  const maxUsers = Number(formData.get("maxUsers") || 10);
  await sql`
    UPDATE platform.companies
    SET plan = ${plan}, max_users = ${maxUsers}
    WHERE id = ${id}
  `;
  revalidatePath("/admin/companies");
}
