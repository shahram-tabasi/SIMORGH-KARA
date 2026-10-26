import "server-only";
import { randomUUID } from "crypto";
import { SignJWT } from "jose";

/**
 * One click from Kara into the HR assistant (hr.simorghai.com), signed in
 * as the same person: a token Kara signs with the secret it shares with the
 * HR chatbot (HR_HANDOFF_SECRET), good for two minutes and once (its jti).
 * It carries who the person is in Kara — name, email, company, position and
 * units — so the assistant answers with their company's rules and their
 * units' own. Authentication and authorization stay Kara's: the HR chatbot
 * accepts the person because Kara says so.
 */
export interface HandoffPerson {
  accountId: string;
  email: string;
  fullName: string;
  title: string | null;
  company: { slug: string; name: string };
  /** The person's units as paths, "A / B / C". */
  units: string[];
}

export const hrAppUrl = () => (process.env.HR_APP_URL ?? "https://hr.simorghai.com").replace(/\/+$/, "");
export const handoffConfigured = () => (process.env.HR_HANDOFF_SECRET ?? "").length >= 32;

export async function handoffToken(p: HandoffPerson): Promise<string> {
  const secret = process.env.HR_HANDOFF_SECRET ?? "";
  if (secret.length < 32) throw new Error("HR_HANDOFF_SECRET is not set");
  return new SignJWT({
    email: p.email, name: p.fullName, title: p.title, company: p.company.slug, companyName: p.company.name, units: p.units,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("kara")
    .setAudience("simorgh-hr")
    .setSubject(p.accountId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));
}
