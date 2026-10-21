"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/session";
import { provisionCompany } from "@/lib/provision";
import { initialPasswordField, initialPasswordHash } from "@/lib/identity";
import { karaApi, syncIdentity } from "@/lib/kara-api";
import { slugify, shortId } from "@/lib/utils";

/** The account is made either way; a sign-in invitation that failed is only logged (import-identities catches up). */
async function logIdentity(warning: string | null) {
  if (warning) console.warn(JSON.stringify({ level: "warn", context: "identity", message: warning }));
}

const newHoldingSchema = z.object({
  name: z.string().min(2, "نام هولدینگ حداقل ۲ کاراکتر باشد."),
  maxCompanies: z.coerce.number().int().min(1).max(1000).default(1),
  adminName: z.string().min(2, "نام مدیر هولدینگ را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر هولدینگ نامعتبر است."),
  adminPassword: initialPasswordField,
});

/** Platform admin sets/raises how many companies a holding may create. */
export async function setHoldingMaxCompaniesAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const max = Math.max(1, Math.min(1000, Number(formData.get("maxCompanies")) || 1));
  await sql`UPDATE platform.holdings SET max_companies = ${max} WHERE id = ${id}`;
  revalidatePath("/admin/holdings");
}

/** Create a holding plus its holding-administrator account. */
export async function createHoldingAction(
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  const { session } = await requirePlatformAdmin();
  const parsed = newHoldingSchema.safeParse({
    name: formData.get("name"),
    maxCompanies: formData.get("maxCompanies") || 1,
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [existing] = await sql`
    SELECT id FROM platform.user_accounts WHERE email = ${parsed.data.adminEmail}
  `;
  if (existing) return { error: "این ایمیل قبلاً ثبت شده است." };

  const slug = `${slugify(parsed.data.name)}-${shortId(4)}`;
  try {
    const [holding] = await sql<{ id: string }[]>`
      INSERT INTO platform.holdings (name, slug, max_companies)
      VALUES (${parsed.data.name}, ${slug}, ${parsed.data.maxCompanies}) RETURNING id
    `;
    const passwordHash = await initialPasswordHash(parsed.data.adminPassword);
    const [admin] = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts
        (email, password_hash, full_name, is_holding_admin, holding_id)
      VALUES (${parsed.data.adminEmail}, ${passwordHash}, ${parsed.data.adminName},
              true, ${holding.id})
      RETURNING id
    `;
    await logIdentity(await syncIdentity(session.sub, admin.id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ساخت هولدینگ." };
  }
  revalidatePath("/admin/holdings");
  redirect("/admin/holdings");
}

const newCompanySchema = z.object({
  name: z.string().min(2, "نام شرکت حداقل ۲ کاراکتر باشد."),
  plan: z.string().default("standard"),
  maxUsers: z.coerce.number().int().min(1).max(100000).default(10),
  adminName: z.string().min(2, "نام مدیر را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر نامعتبر است."),
  adminPassword: initialPasswordField,
});

export interface CompanyFormState {
  error?: string;
}

export async function createCompanyAction(
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  const { session } = await requirePlatformAdmin();

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
    const { adminAccountId } = await provisionCompany(parsed.data);
    await logIdentity(await syncIdentity(session.sub, adminAccountId));
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

/** A tenant ↔ its Odoo company (kara-api checks the company exists). Empty unlinks. */
export async function linkOdooCompanyAction(formData: FormData) {
  const { session } = await requirePlatformAdmin();
  const slug = String(formData.get("slug"));
  const raw = String(formData.get("odooCompanyId") ?? "");
  try {
    await karaApi(session.sub, "PUT", `/v1/admin/tenants/${slug}/erp-link`, {
      body: { odooCompanyId: raw ? Number(raw) : null },
    });
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", context: "erp-link", message: (e as Error).message }));
  }
  revalidatePath("/admin/companies");
}
