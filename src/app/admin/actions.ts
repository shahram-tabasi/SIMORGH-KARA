"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/session";
import { provisionCompany } from "@/lib/provision";
import { initialPasswordField, initialPasswordHash } from "@/lib/identity";
import { karaApi, karaApiEnabled, syncIdentity } from "@/lib/kara-api";
import { slugify, shortId } from "@/lib/utils";
import { enqueueCompanyMembers, enqueueSync } from "@/lib/sync";
import { APPS, type CompanyApps } from "@/lib/apps";

/** The app switches of a company form: a checkbox per app (`app_<key>`). */
const appsFrom = (formData: FormData): CompanyApps =>
  Object.fromEntries(APPS.map((a) => [a.key, formData.get(`app_${a.key}`) === "on"]));

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
    const { adminAccountId, slug } = await provisionCompany({ ...parsed.data, apps: appsFrom(formData) });
    await logIdentity(await syncIdentity(session.sub, adminAccountId));
    if (formData.get("createOdooCompany") === "on" && karaApiEnabled()) {
      try {
        await karaApi(session.sub, "POST", `/v1/admin/tenants/${slug}/erp-company`);
      } catch (e) {
        // The company exists in Kara either way; linking can be done on /admin/companies.
        console.warn(JSON.stringify({ level: "warn", context: "erp-company", message: (e as Error).message }));
      }
    }
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
  await sql.begin(async (tx) => {
    await tx`
      UPDATE platform.companies SET status = ${status} WHERE id = ${id}
    `;
    // A suspended company's people lose the apps; back to active, they get them again.
    await enqueueSync(tx, "company", id, id, `status ${status}`);
    await enqueueCompanyMembers(tx, id, `company ${status}`);
  });
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

/**
 * The platform apps a company may use (Design Suite, HR chatbot). Turning one
 * on lets its admins give people access; turning it off takes the app from
 * everyone in the company (their accounts in its realm are disabled).
 */
export async function setCompanyAppsAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const apps = appsFrom(formData);
  await sql.begin(async (tx) => {
    await tx`UPDATE platform.companies SET apps = ${tx.json(apps)} WHERE id = ${id}`;
    await enqueueSync(tx, "company", id, id, `apps: ${APPS.filter((a) => apps[a.key]).map((a) => a.key).join(", ") || "none"}`);
    await enqueueCompanyMembers(tx, id, "company apps changed");
  });
  revalidatePath("/admin/companies");
}

/** Run the company and every person of it through provisioning again (after a failure, or to repair drift). */
export async function resyncCompanyAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  await sql.begin(async (tx) => {
    await enqueueSync(tx, "company", id, id, "resync by the platform admin");
    await enqueueCompanyMembers(tx, id, "resync by the platform admin");
  });
  revalidatePath("/admin/companies");
}

/**
 * A tenant ↔ its Odoo company: an existing one (kara-api checks it exists),
 * "new" for a company made in Odoo with the tenant's name, empty to unlink.
 * Errors come back to the page as ?erp_error=…&erp_slug=….
 */
export async function linkOdooCompanyAction(formData: FormData) {
  const { session } = await requirePlatformAdmin();
  const slug = String(formData.get("slug"));
  const raw = String(formData.get("odooCompanyId") ?? "");
  let error: string | null = null;
  try {
    if (raw === "new") {
      await karaApi(session.sub, "POST", `/v1/admin/tenants/${slug}/erp-company`);
    } else {
      await karaApi(session.sub, "PUT", `/v1/admin/tenants/${slug}/erp-link`, {
        body: { odooCompanyId: raw ? Number(raw) : null },
      });
    }
  } catch (e) {
    error = (e as Error).message;
  }
  revalidatePath("/admin/companies");
  if (error) redirect(`/admin/companies?erp_slug=${encodeURIComponent(slug)}&erp_error=${encodeURIComponent(error.slice(0, 300))}`);
}
