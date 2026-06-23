"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

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
    }[]
  >`
    SELECT id, email, full_name, password_hash, is_platform_admin,
           is_holding_admin, holding_id, company_id, status
    FROM platform.user_accounts WHERE email = ${email}
  `;

  if (!account || account.status !== "active") {
    return { error: "ایمیل یا رمز عبور نادرست است." };
  }

  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) {
    return { error: "ایمیل یا رمز عبور نادرست است." };
  }

  if (account.is_platform_admin) {
    await createSession({
      sub: account.id,
      email: account.email,
      name: account.full_name,
      kind: "platform",
    });
    redirect("/admin");
  }

  if (account.is_holding_admin && account.holding_id) {
    await createSession({
      sub: account.id,
      email: account.email,
      name: account.full_name,
      kind: "holding",
      holdingId: account.holding_id,
    });
    redirect("/holding");
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
  redirect(`/app/${company.slug}`);
}
