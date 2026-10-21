"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { startSession, type AccountRow } from "@/lib/login";
import { passwordLoginEnabled } from "@/lib/oidc";

export interface CompanyLoginState {
  error?: string;
}

/**
 * Company-scoped login: the company is fixed by the URL slug (its own
 * domain/address), so the user only types their username + password.
 */
export async function companyLoginAction(
  _prev: CompanyLoginState,
  formData: FormData
): Promise<CompanyLoginState> {
  const slug = String(formData.get("slug") || "");
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) return { error: "نام کاربری و رمز عبور را وارد کنید." };

  if (!passwordLoginEnabled()) return { error: "ورود با رمز عبور غیرفعال است؛ از «ورود با حساب سیمرغ» استفاده کنید." };

  const [company] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM platform.companies WHERE slug = ${slug}
  `;
  if (!company || company.status === "suspended") {
    return { error: "شرکت یافت نشد یا غیرفعال است." };
  }

  // Match by username within this company; fall back to email for convenience.
  const [account] = await sql<(AccountRow & { password_hash: string })[]>`
    SELECT id, email, full_name, password_hash, is_platform_admin,
           is_holding_admin, holding_id, company_id, status
    FROM platform.user_accounts
    WHERE company_id = ${company.id}
      AND (username = ${username} OR email = ${username})
    LIMIT 1
  `;

  if (!account || account.status !== "active") {
    return { error: "نام کاربری یا رمز عبور نادرست است." };
  }
  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) return { error: "نام کاربری یا رمز عبور نادرست است." };

  const outcome = await startSession(account, slug);
  if ("error" in outcome) return outcome;
  redirect(outcome.redirectTo);
}
