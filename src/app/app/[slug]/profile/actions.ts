"use server";

import { revalidatePath } from "next/cache";
import { sql, withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";

export interface ProfileState {
  error?: string;
  ok?: string;
}

/** The signed-in member changes their own password. */
export async function changePasswordAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  const confirm = String(formData.get("confirm") || "");

  if (next.length < 6) return { error: "رمز جدید باید حداقل ۶ نویسه باشد." };
  if (next !== confirm) return { error: "رمز جدید و تکرار آن یکسان نیستند." };

  const [account] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM platform.user_accounts WHERE id = ${ctx.session.sub}
  `;
  if (!account) return { error: "حساب یافت نشد." };

  const ok = await verifyPassword(current, account.password_hash);
  if (!ok) return { error: "رمز عبور فعلی نادرست است." };

  const hash = await hashPassword(next);
  await sql`
    UPDATE platform.user_accounts SET password_hash = ${hash}
    WHERE id = ${ctx.session.sub}
  `;
  return { ok: "رمز عبور با موفقیت تغییر کرد." };
}

/** The signed-in member updates their own avatar photo (data URL or link). */
export async function updateAvatarAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const avatar = String(formData.get("avatar") || "").trim();

  // Guard against oversized payloads (data URLs are stored inline).
  if (avatar && avatar.length > 400_000)
    return { error: "حجم تصویر زیاد است؛ تصویر کوچک‌تری انتخاب کنید." };
  if (avatar && !/^data:image\/|^https?:\/\//.test(avatar))
    return { error: "تصویر نامعتبر است." };

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE members SET avatar_url = ${avatar || null}
      WHERE id = ${ctx.member.memberId}
    `;
  });
  revalidatePath(`/app/${slug}/profile`);
  revalidatePath(`/app/${slug}`);
  return { ok: "تصویر پروفایل به‌روزرسانی شد." };
}
