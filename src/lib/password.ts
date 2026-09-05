import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

/** Password hashing helpers — kept free of next/* imports so they can be used
 *  from both server components and standalone scripts (seeding, tests). */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a readable one-off password for an admin-initiated reset.
 * Ambiguous glyphs (O/0, l/1/I) are excluded so the password can be read out
 * over the phone without confusion.
 */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
