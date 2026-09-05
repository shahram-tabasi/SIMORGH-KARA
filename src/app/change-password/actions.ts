"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hashPassword, verifyPassword, DEFAULT_PASSWORD } from "@/lib/password";

export interface ChangeState {
  error?: string;
}

/**
 * The forced first-login password change. Works for every kind of session
 * (platform, holding, tenant) because it only needs the account id, and sends
 * the user on to their own panel once the password is really theirs.
 */
export async function forcePasswordChangeAction(
  _prev: ChangeState,
  formData: FormData
): Promise<ChangeState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  const confirm = String(formData.get("confirmPassword") || "");

  if (next.length < 6) return { error: "رمز جدید باید حداقل ۶ نویسه باشد." };
  if (next !== confirm) return { error: "رمز جدید و تکرار آن یکسان نیستند." };
  if (next === DEFAULT_PASSWORD) {
    return { error: "رمز جدید نمی‌تواند همان رمز پیش‌فرض باشد." };
  }
  if (next === current) return { error: "رمز جدید باید با رمز فعلی متفاوت باشد." };

  const [account] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM platform.user_accounts WHERE id = ${session.sub}
  `;
  if (!account) redirect("/login");
  if (!(await verifyPassword(current, account.password_hash))) {
    return { error: "رمز عبور فعلی نادرست است." };
  }

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(next)}, must_change_password = false
    WHERE id = ${session.sub}
  `;

  redirect(
    session.kind === "platform"
      ? "/admin"
      : session.kind === "holding"
        ? "/holding"
        : `/app/${session.slug}`
  );
}
