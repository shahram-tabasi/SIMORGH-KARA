"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { startSession, type AccountRow } from "@/lib/login";
import { passwordLoginEnabled } from "@/lib/oidc";

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

  if (!passwordLoginEnabled()) return { error: "ورود با رمز عبور غیرفعال است؛ از «ورود با حساب سیمرغ» استفاده کنید." };

  const [account] = await sql<(AccountRow & { password_hash: string })[]>`
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

  const outcome = await startSession(account);
  if ("error" in outcome) return outcome;
  redirect(outcome.redirectTo);
}
