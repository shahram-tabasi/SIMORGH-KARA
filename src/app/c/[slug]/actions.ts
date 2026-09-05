"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { DEFAULT_PASSWORD } from "@/lib/password";

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

  const [company] = await sql<
    { id: string; slug: string; schema_name: string; status: string }[]
  >`
    SELECT id, slug, schema_name, status FROM platform.companies WHERE slug = ${slug}
  `;
  if (!company || company.status === "suspended") {
    return { error: "شرکت یافت نشد یا غیرفعال است." };
  }

  // Match by username within this company; fall back to email for convenience.
  const [account] = await sql<
    {
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      status: string;
      must_change_password: boolean;
    }[]
  >`
    SELECT id, email, full_name, password_hash, status, must_change_password
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

  const mustChange = account.must_change_password || password === DEFAULT_PASSWORD;
  if (mustChange && !account.must_change_password) {
    await sql`
      UPDATE platform.user_accounts SET must_change_password = true
      WHERE id = ${account.id}
    `;
  }

  await createSession({
    sub: account.id,
    email: account.email,
    name: account.full_name,
    kind: "tenant",
    companyId: company.id,
    schema: company.schema_name,
    slug: company.slug,
  });
  redirect(mustChange ? "/change-password" : `/app/${company.slug}`);
}
