"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import type { AccountState } from "@/components/AccountEditor";
import { requirePlatformAdmin } from "@/lib/session";
import { createSession } from "@/lib/auth";
import { provisionCompany } from "@/lib/provision";
import { hashPassword, verifyPassword, DEFAULT_PASSWORD } from "@/lib/password";
import { slugify, shortId } from "@/lib/utils";
import { normalizeModules, ALL_MODULES } from "@/lib/modules";

/** Read the checked panels out of a form. */
function modulesFromForm(formData: FormData): string[] {
  return normalizeModules(formData.getAll("modules").map(String));
}

const newHoldingSchema = z.object({
  name: z.string().min(2, "نام هولدینگ حداقل ۲ کاراکتر باشد."),
  maxCompanies: z.coerce.number().int().min(1).max(1000).default(1),
  adminName: z.string().min(2, "نام مدیر هولدینگ را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر هولدینگ نامعتبر است."),
  // Empty means «رمز پیش‌فرض»: the admin does not have to invent one.
  adminPassword: z.string().default(DEFAULT_PASSWORD),
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
  await requirePlatformAdmin();
  const parsed = newHoldingSchema.safeParse({
    name: formData.get("name"),
    maxCompanies: formData.get("maxCompanies") || 1,
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: String(formData.get("adminPassword") || "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [existing] = await sql`
    SELECT id FROM platform.user_accounts WHERE email = ${parsed.data.adminEmail}
  `;
  if (existing) return { error: "این ایمیل قبلاً ثبت شده است." };

  const slug = `${slugify(parsed.data.name)}-${shortId(4)}`;
  try {
    const modules = formData.getAll("modules").length
      ? modulesFromForm(formData)
      : ALL_MODULES;
    const [holding] = await sql<{ id: string }[]>`
      INSERT INTO platform.holdings (name, slug, max_companies, modules)
      VALUES (${parsed.data.name}, ${slug}, ${parsed.data.maxCompanies}, ${modules})
      RETURNING id
    `;
    const passwordHash = await hashPassword(parsed.data.adminPassword);
    await sql`
      INSERT INTO platform.user_accounts
        (email, password_hash, full_name, is_holding_admin, holding_id)
      VALUES (${parsed.data.adminEmail}, ${passwordHash}, ${parsed.data.adminName},
              true, ${holding.id})
    `;
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
  adminPassword: z.string().default(DEFAULT_PASSWORD),
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
    adminPassword: String(formData.get("adminPassword") || "").trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await provisionCompany({ ...parsed.data, modules: modulesFromForm(formData) });
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

/** Platform admin switches panels (پنل‌ها) on/off for one company. */
export async function setCompanyModulesAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const modules = modulesFromForm(formData);
  await sql`UPDATE platform.companies SET modules = ${modules} WHERE id = ${id}`;
  revalidatePath("/admin/companies");
}

/**
 * Platform admin sets which panels a holding is licensed to hand out. Panels
 * removed from the licence are also pulled from the holding's companies, so a
 * holding can never keep serving a panel it no longer owns.
 */
export async function setHoldingModulesAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = String(formData.get("id"));
  const modules = modulesFromForm(formData);
  await sql`UPDATE platform.holdings SET modules = ${modules} WHERE id = ${id}`;
  await sql`
    UPDATE platform.companies
    SET modules = ARRAY(
      SELECT unnest(modules) INTERSECT SELECT unnest(${modules}::text[])
    )
    WHERE holding_id = ${id}
  `;
  revalidatePath("/admin/holdings");
  revalidatePath("/admin/companies");
}

/* ═══════════════ مدیریت حساب‌ها: ایمیل، نام کاربری و رمز عبور ═══════════════ */

export type { AccountState };

const profileSchema = z.object({
  fullName: z.string().min(2, "نام و نام خانوادگی را وارد کنید."),
  email: z.string().email("ایمیل نامعتبر است."),
});

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;

/** True when this e-mail already belongs to a *different* account. */
async function emailTaken(email: string, exceptId: string): Promise<boolean> {
  const [dup] = await sql<{ id: string }[]>`
    SELECT id FROM platform.user_accounts
    WHERE email = ${email} AND id <> ${exceptId}
  `;
  return Boolean(dup);
}

/* ------------------------- حساب خودِ مدیر سیمرغ ------------------------- */

/** Super admin edits their own name and login e-mail. */
export async function updateOwnProfileAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const { session } = await requirePlatformAdmin();

  const parsed = profileSchema.safeParse({
    fullName: String(formData.get("fullName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (await emailTaken(parsed.data.email, session.sub)) {
    return { error: "این ایمیل قبلاً برای حساب دیگری ثبت شده است." };
  }

  try {
    await sql`
      UPDATE platform.user_accounts
      SET email = ${parsed.data.email}, full_name = ${parsed.data.fullName}
      WHERE id = ${session.sub}
    `;
  } catch {
    return { error: "ثبت ایمیل ممکن نشد؛ احتمالاً تکراری است." };
  }

  // The session carries the e-mail and name — reissue it so the panel does not
  // keep showing the old identity until the next login.
  await createSession({ ...session, email: parsed.data.email, name: parsed.data.fullName });

  revalidatePath("/admin/account");
  return { ok: "ایمیل و نام حساب شما به‌روزرسانی شد." };
}

/** Super admin changes their own password — current password required. */
export async function changeOwnPasswordAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const { session } = await requirePlatformAdmin();

  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  const confirm = String(formData.get("confirmPassword") || "");

  if (next.length < MIN_PASSWORD) {
    return { error: `رمز جدید حداقل ${MIN_PASSWORD} نویسه باشد.` };
  }
  if (next !== confirm) return { error: "تکرار رمز جدید مطابقت ندارد." };

  const [account] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM platform.user_accounts WHERE id = ${session.sub}
  `;
  if (!account || !(await verifyPassword(current, account.password_hash))) {
    return { error: "رمز عبور فعلی نادرست است." };
  }

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(next)}
    WHERE id = ${session.sub}
  `;
  return { ok: "رمز عبور شما تغییر کرد." };
}

/* --------------------- حساب مدیران شرکت‌ها و هولدینگ‌ها --------------------- */

interface ManagedAccount {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  status: string;
  company_id: string | null;
  holding_id: string | null;
}

/**
 * Load an account the platform admin is allowed to manage. Another platform
 * admin is never editable from here — those accounts are only changed by their
 * own owner in «حساب من».
 */
async function loadManagedAccount(id: string): Promise<ManagedAccount | null> {
  const [account] = await sql<(ManagedAccount & { is_platform_admin: boolean })[]>`
    SELECT id, email, username, full_name, status, company_id, holding_id,
           is_platform_admin
    FROM platform.user_accounts WHERE id = ${id}
  `;
  if (!account || account.is_platform_admin) return null;
  return account;
}

/** Keep the tenant-side member row in step with the platform identity. */
async function syncMemberName(
  companyId: string | null,
  accountId: string,
  fullName: string
): Promise<void> {
  if (!companyId) return;
  const [company] = await sql<{ schema_name: string }[]>`
    SELECT schema_name FROM platform.companies WHERE id = ${companyId}
  `;
  if (!company) return;
  await withTenant(company.schema_name, async (tx) => {
    await tx`
      UPDATE members SET full_name = ${fullName} WHERE account_id = ${accountId}
    `;
  });
}

/** Super admin corrects a manager's e-mail, login username or name. */
export async function updateManagedAccountAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  await requirePlatformAdmin();
  const accountId = String(formData.get("accountId") || "");
  const account = await loadManagedAccount(accountId);
  if (!account) return { error: "این حساب قابل ویرایش از این صفحه نیست." };

  const parsed = profileSchema.safeParse({
    fullName: String(formData.get("fullName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const username = String(formData.get("username") || "").trim();
  if (username && !USERNAME_RE.test(username)) {
    return { error: "نام کاربری ۳ تا ۳۲ نویسهٔ انگلیسی، عدد یا . _ - باشد." };
  }

  if (await emailTaken(parsed.data.email, accountId)) {
    return { error: "این ایمیل قبلاً برای حساب دیگری ثبت شده است." };
  }

  if (username && account.company_id) {
    const [dup] = await sql<{ id: string }[]>`
      SELECT id FROM platform.user_accounts
      WHERE company_id = ${account.company_id} AND username = ${username}
        AND id <> ${accountId}
    `;
    if (dup) return { error: "این نام کاربری در همین شرکت استفاده شده است." };
  }

  try {
    await sql`
      UPDATE platform.user_accounts
      SET email = ${parsed.data.email},
          full_name = ${parsed.data.fullName},
          username = ${username || null}
      WHERE id = ${accountId}
    `;
  } catch {
    return { error: "ذخیره ممکن نشد؛ ایمیل یا نام کاربری تکراری است." };
  }

  await syncMemberName(account.company_id, accountId, parsed.data.fullName);

  revalidatePath("/admin/companies");
  revalidatePath("/admin/holdings");
  if (account.company_id) {
    revalidatePath(`/admin/companies/${account.company_id}/users`);
  }
  return { ok: "اطلاعات حساب ذخیره شد." };
}

/**
 * Admin-initiated password reset. Either a password typed by the admin, or —
 * when the field is left empty — a generated one. The result is returned once
 * so the admin can hand it over; it is never stored in plaintext.
 */
export async function resetManagedPasswordAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  await requirePlatformAdmin();
  const accountId = String(formData.get("accountId") || "");
  const account = await loadManagedAccount(accountId);
  if (!account) return { error: "این حساب قابل بازنشانی از این صفحه نیست." };

  const typed = String(formData.get("newPassword") || "").trim();
  if (typed && typed.length < MIN_PASSWORD) {
    return { error: `رمز جدید حداقل ${MIN_PASSWORD} نویسه باشد.` };
  }
  const password = typed || DEFAULT_PASSWORD;

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(password)}
    WHERE id = ${accountId}
  `;

  revalidatePath("/admin/companies");
  revalidatePath("/admin/holdings");
  return {
    ok: `رمز عبور «${account.full_name}» بازنشانی شد.`,
    password,
  };
}

/** Enable or disable a managed login without deleting the account. */
export async function setAccountStatusAction(formData: FormData) {
  await requirePlatformAdmin();
  const accountId = String(formData.get("accountId") || "");
  const account = await loadManagedAccount(accountId);
  if (!account) return;
  const status = account.status === "active" ? "disabled" : "active";
  await sql`
    UPDATE platform.user_accounts SET status = ${status} WHERE id = ${accountId}
  `;
  revalidatePath("/admin/companies");
  revalidatePath("/admin/holdings");
  if (account.company_id) {
    revalidatePath(`/admin/companies/${account.company_id}/users`);
  }
}
