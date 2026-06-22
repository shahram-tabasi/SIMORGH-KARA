import bcrypt from "bcryptjs";

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
