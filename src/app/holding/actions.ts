"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireHolding } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { provisionCompany } from "@/lib/provision";
import { DEFAULT_PASSWORD, hashPassword, verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import type { AccountState } from "@/components/AccountEditor";
import { intersectModules, normalizeModules } from "@/lib/modules";

const schema = z.object({
  name: z.string().min(2, "نام شرکت را وارد کنید."),
  maxUsers: z.coerce.number().int().min(1).max(100000).default(25),
  adminName: z.string().min(2, "نام مدیر شرکت را وارد کنید."),
  adminEmail: z.string().email("ایمیل مدیر شرکت نامعتبر است."),
  // Empty means «رمز پیش‌فرض ۱۲۳۴۵۶».
  adminPassword: z.string().default(DEFAULT_PASSWORD),
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
    adminPassword: String(formData.get("adminPassword") || "").trim() || undefined,
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

  // A holding may only switch on panels it is licensed for.
  const modules = intersectModules(
    formData.getAll("modules").map(String),
    ctx.holding.modules
  );

  try {
    await provisionCompany({ ...parsed.data, holdingId: ctx.holding.id, modules });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطا در ساخت شرکت." };
  }

  revalidatePath("/holding");
  redirect("/holding");
}

/**
 * Holding admin turns panels on/off for one of its own companies. The request
 * is intersected with the holding's licence, so a holding can never grant a
 * panel the platform did not sell it — «برای بعضی شرکت‌ها بعضی پنل‌ها تهیه نشود».
 */
export async function setHoldingCompanyModulesAction(formData: FormData) {
  const ctx = await requireHolding();
  const companyId = String(formData.get("companyId"));

  const [company] = await sql<{ id: string }[]>`
    SELECT id FROM platform.companies
    WHERE id = ${companyId} AND holding_id = ${ctx.holding.id}
  `;
  if (!company) return; // not one of ours

  const modules = intersectModules(
    formData.getAll("modules").map(String),
    ctx.holding.modules
  );
  await sql`
    UPDATE platform.companies SET modules = ${normalizeModules(modules)}
    WHERE id = ${companyId}
  `;
  revalidatePath("/holding");
}

/* ═════════ حساب‌های زیرمجموعه: ایمیل و بازنشانی رمز در سطح هولدینگ ═════════ */

/**
 * Every account action below is scoped to *this* holding: the account must
 * belong to a company owned by the holding (or be the holding's own admin), and
 * never be a platform admin. That is what lets each level serve its own people
 * without anyone escalating sideways or upward.
 */
async function holdingScopedAccount(
  holdingId: string,
  accountId: string
): Promise<{ id: string; company_id: string | null; full_name: string } | null> {
  const [account] = await sql<
    {
      id: string;
      company_id: string | null;
      holding_id: string | null;
      full_name: string;
      is_platform_admin: boolean;
      is_holding_admin: boolean;
    }[]
  >`
    SELECT ua.id, ua.company_id, ua.holding_id, ua.full_name,
           ua.is_platform_admin, ua.is_holding_admin
    FROM platform.user_accounts ua
    WHERE ua.id = ${accountId}
  `;
  if (!account || account.is_platform_admin) return null;

  // its own holding-admin colleagues are out of reach too — only the platform
  // admin resets those, so a holding admin cannot take over the holding.
  if (account.is_holding_admin) return null;

  if (!account.company_id) return null;
  const [company] = await sql<{ id: string }[]>`
    SELECT id FROM platform.companies
    WHERE id = ${account.company_id} AND holding_id = ${holdingId}
  `;
  if (!company) return null;

  return {
    id: account.id,
    company_id: account.company_id,
    full_name: account.full_name,
  };
}

/** Holding admin corrects the login e-mail / name / username of a subsidiary's user. */
export async function updateHoldingUserAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const ctx = await requireHolding();
  const accountId = String(formData.get("accountId") || "");
  const account = await holdingScopedAccount(ctx.holding.id, accountId);
  if (!account) return { error: "این حساب در دسترس هولدینگ شما نیست." };

  const fullName = String(formData.get("fullName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const username = String(formData.get("username") || "").trim();

  if (fullName.length < 2) return { error: "نام و نام خانوادگی را وارد کنید." };
  if (!z.string().email().safeParse(email).success) {
    return { error: "ایمیل نامعتبر است." };
  }
  if (username && !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return { error: "نام کاربری ۳ تا ۳۲ نویسهٔ انگلیسی، عدد یا . _ - باشد." };
  }

  const [dup] = await sql<{ id: string }[]>`
    SELECT id FROM platform.user_accounts WHERE email = ${email} AND id <> ${accountId}
  `;
  if (dup) return { error: "این ایمیل قبلاً ثبت شده است." };

  if (username) {
    const [dupUser] = await sql<{ id: string }[]>`
      SELECT id FROM platform.user_accounts
      WHERE company_id = ${account.company_id} AND username = ${username}
        AND id <> ${accountId}
    `;
    if (dupUser) return { error: "این نام کاربری در همین شرکت استفاده شده است." };
  }

  try {
    await sql`
      UPDATE platform.user_accounts
      SET email = ${email}, full_name = ${fullName}, username = ${username || null}
      WHERE id = ${accountId}
    `;
  } catch {
    return { error: "ذخیره ممکن نشد؛ ایمیل یا نام کاربری تکراری است." };
  }

  // keep the tenant-side member row in step
  const [company] = await sql<{ schema_name: string }[]>`
    SELECT schema_name FROM platform.companies WHERE id = ${account.company_id}
  `;
  if (company) {
    await withTenant(company.schema_name, async (tx) => {
      await tx`
        UPDATE members SET full_name = ${fullName} WHERE account_id = ${accountId}
      `;
    });
  }

  revalidatePath(`/holding/companies/${account.company_id}/users`);
  return { ok: "اطلاعات حساب ذخیره شد." };
}

/** Holding admin resets a subsidiary user's password (default: ۱۲۳۴۵۶). */
export async function resetHoldingUserPasswordAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const ctx = await requireHolding();
  const accountId = String(formData.get("accountId") || "");
  const account = await holdingScopedAccount(ctx.holding.id, accountId);
  if (!account) return { error: "این حساب در دسترس هولدینگ شما نیست." };

  const typed = String(formData.get("newPassword") || "").trim();
  if (typed && typed.length < 6) return { error: "رمز جدید حداقل ۶ نویسه باشد." };
  const password = typed || DEFAULT_PASSWORD;

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(password)}
    WHERE id = ${accountId}
  `;

  revalidatePath(`/holding/companies/${account.company_id}/users`);
  return { ok: `رمز عبور «${account.full_name}» بازنشانی شد.`, password };
}

/** Enable or disable a subsidiary user's login. */
export async function setHoldingUserStatusAction(formData: FormData) {
  const ctx = await requireHolding();
  const accountId = String(formData.get("accountId") || "");
  const account = await holdingScopedAccount(ctx.holding.id, accountId);
  if (!account) return;

  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM platform.user_accounts WHERE id = ${accountId}
  `;
  const status = row?.status === "active" ? "disabled" : "active";
  await sql`
    UPDATE platform.user_accounts SET status = ${status} WHERE id = ${accountId}
  `;
  revalidatePath(`/holding/companies/${account.company_id}/users`);
}

/* ------------------------- حساب خودِ مدیر هولدینگ ------------------------- */

/** Holding admin edits their own login e-mail and name. */
export async function updateHoldingProfileAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const ctx = await requireHolding();
  const fullName = String(formData.get("fullName") || "").trim();
  const email = String(formData.get("email") || "").trim();

  if (fullName.length < 2) return { error: "نام و نام خانوادگی را وارد کنید." };
  if (!z.string().email().safeParse(email).success) {
    return { error: "ایمیل نامعتبر است." };
  }

  const [dup] = await sql<{ id: string }[]>`
    SELECT id FROM platform.user_accounts
    WHERE email = ${email} AND id <> ${ctx.session.sub}
  `;
  if (dup) return { error: "این ایمیل قبلاً برای حساب دیگری ثبت شده است." };

  try {
    await sql`
      UPDATE platform.user_accounts
      SET email = ${email}, full_name = ${fullName}
      WHERE id = ${ctx.session.sub}
    `;
  } catch {
    return { error: "ثبت ایمیل ممکن نشد؛ احتمالاً تکراری است." };
  }

  await createSession({ ...ctx.session, email, name: fullName });
  revalidatePath("/holding/account");
  return { ok: "ایمیل و نام حساب شما به‌روزرسانی شد." };
}

/** Holding admin changes their own password — current password required. */
export async function changeHoldingPasswordAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const ctx = await requireHolding();
  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  const confirm = String(formData.get("confirmPassword") || "");

  if (next.length < 6) return { error: "رمز جدید حداقل ۶ نویسه باشد." };
  if (next !== confirm) return { error: "تکرار رمز جدید مطابقت ندارد." };

  const [account] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM platform.user_accounts WHERE id = ${ctx.session.sub}
  `;
  if (!account || !(await verifyPassword(current, account.password_hash))) {
    return { error: "رمز عبور فعلی نادرست است." };
  }

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(next)}
    WHERE id = ${ctx.session.sub}
  `;
  return { ok: "رمز عبور شما تغییر کرد." };
}
