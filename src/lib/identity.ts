import "server-only";
import { randomBytes } from "crypto";
import { z } from "zod";
import { hashPassword } from "@/lib/password";
import { passwordLoginEnabled } from "@/lib/oidc";

/**
 * The initial password of a new account. With Keycloak sign-in only, nobody
 * types one: the account keeps an unknown random hash (Kara's password form
 * is off anyway) and Keycloak emails the person a link to set their own.
 */
export const initialPasswordField = passwordLoginEnabled()
  ? z.string().min(6, "رمز عبور حداقل ۶ کاراکتر باشد.")
  // With Keycloak: optional. Given, it becomes the person's temporary
  // Keycloak password (changed at the first sign-in) instead of the email
  // link. A form without the field sends null (FormData.get), not undefined.
  : z.union([z.literal(""), z.string().min(8, "رمز اولیه حداقل ۸ کاراکتر باشد (یا خالی بماند تا پیوند تعیین رمز ایمیل شود).")]).nullish();

export function initialPasswordHash(password: string | undefined | null): Promise<string> {
  return hashPassword(password || randomBytes(32).toString("base64url"));
}
