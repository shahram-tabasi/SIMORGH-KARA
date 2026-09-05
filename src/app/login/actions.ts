"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { DEFAULT_PASSWORD } from "@/lib/password";

const schema = z.object({
  email: z.string().email("ایمیل نامعتبر است."),
  password: z.string().min(1, "رمز عبور را وارد کنید."),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password } = parsed.data;

  const [account] = await sql<
    {
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      is_platform_admin: boolean;
      is_holding_admin: boolean;
      holding_id: string | null;
      company_id: string | null;
      status: string;
      must_change_password: boolean;
    }[]
  >`
    SELECT id, email, full_name, password_hash, is_platform_admin,
           is_holding_admin, holding_id, company_id, status,
           must_change_password
    FROM platform.user_accounts WHERE email = ${email}
  `;

  if (!account || account.status !== "active") {
    return { error: "ایمیل یا رمز عبور نادرست است." };
  }

  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) {
    return { error: "ایمیل یا رمز عبور نادرست است." };
  }

  // Anyone still signing in with the shared default is flagged here too, so
  // accounts that predate the flag are caught the first time they appear.
  const mustChange = account.must_change_password || password === DEFAULT_PASSWORD;
  if (mustChange && !account.must_change_password) {
    await sql`
      UPDATE platform.user_accounts SET must_change_password = true
      WHERE id = ${account.id}
    `;
  }

  if (account.is_platform_admin) {
    await createSession({
      sub: account.id,
      email: account.email,
      name: account.full_name,
      kind: "platform",
    });
    redirect(mustChange ? "/change-password" : "/admin");
  }

  if (account.is_holding_admin && account.holding_id) {
    await createSession({
      sub: account.id,
      email: account.email,
      name: account.full_name,
      kind: "holding",
      holdingId: account.holding_id,
    });
    redirect(mustChange ? "/change-password" : "/holding");
  }

  if (!account.company_id) {
    return { error: "این حساب به هیچ شرکتی متصل نیست." };
  }

  const [company] = await sql<
    { slug: string; schema_name: string; status: string }[]
  >`
    SELECT slug, schema_name, status FROM platform.companies
    WHERE id = ${account.company_id}
  `;

  if (!company || company.status === "suspended") {
    return { error: "دسترسی شرکت شما غیرفعال شده است. با پشتیبانی تماس بگیرید." };
  }

  await createSession({
    sub: account.id,
    email: account.email,
    name: account.full_name,
    kind: "tenant",
    companyId: account.company_id,
    schema: company.schema_name,
    slug: company.slug,
  });
  redirect(mustChange ? "/change-password" : `/app/${company.slug}`);
}
