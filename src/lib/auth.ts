import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export { hashPassword, verifyPassword } from "./password";

const COOKIE_NAME = "sk_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return new TextEncoder().encode(s);
}

export interface SessionData {
  /** platform.user_accounts.id */
  sub: string;
  email: string;
  name: string;
  kind: "platform" | "holding" | "tenant";
  // present only for tenant sessions:
  companyId?: string;
  schema?: string;
  slug?: string;
  // present only for holding sessions:
  holdingId?: string;
}

export async function createSession(data: SessionData): Promise<void> {
  const token = await new SignJWT({ ...data })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<SessionData | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}

export function destroySession(): void {
  cookies().delete(COOKIE_NAME);
}
