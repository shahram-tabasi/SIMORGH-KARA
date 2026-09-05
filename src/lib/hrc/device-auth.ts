import "server-only";
import { createHash, randomBytes, createPublicKey, verify as cryptoVerify } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { sql, withTenant } from "@/lib/db";
import { normalizeModules, hasModule, type ModuleKey } from "@/lib/modules";
import { HrcError, unauthorized, forbidden, notFound } from "./http";

/**
 * هویت دستگاه ایمنی — سه‌مرحله‌ای و بدون هیچ کلید خصوصی روی سرور.
 *
 *   ۱) بلیت    کارمند با کد شرکت + ایمیل + رمز وارد می‌شود → بلیت یک‌بارمصرف ۱۰ دقیقه‌ای
 *   ۲) ثبت     اپ کلید را در Android Keystore می‌سازد و فقط کلید عمومی را می‌فرستد
 *   ۳) نشست    سرور توکن دستگاه (۳۰ روزه) می‌دهد؛ ابطال با SUSPENDED/RETIRED فوری است
 *   ۴) تازه‌سازی چالش تصادفی سرور را با کلید Keystore امضا می‌کند
 *
 * The private key never leaves the phone. The server stores only the public
 * key, so a stolen database cannot impersonate a device.
 */

const TICKET_TTL_MIN = 10;
const CHALLENGE_TTL_MIN = 5;
const DEVICE_TOKEN_DAYS = 30;

/**
 * A key derived from SESSION_SECRET, domain-separated so a device token can
 * never be replayed as a browser session cookie (or the other way round).
 */
function deviceSecret(): Uint8Array {
  const s = process.env.HRC_DEVICE_SECRET || process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return new Uint8Array(createHash("sha256").update(`${s}|hrc-device-v2`).digest());
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/* ────────────────────────────── tenant lookup ────────────────────────────── */

export interface TenantRef {
  companyId: string;
  slug: string;
  schema: string;
  name: string;
  modules: ModuleKey[];
}

export async function tenantBySlug(slug: string): Promise<TenantRef> {
  const [c] = await sql<
    { id: string; name: string; schema_name: string; status: string; modules: string[] | null }[]
  >`SELECT id, name, schema_name, status, modules FROM platform.companies WHERE slug = ${slug}`;
  if (!c || c.status === "suspended") throw notFound("شرکت یافت نشد");
  const modules = normalizeModules(c.modules);
  if (!hasModule(modules, "hrc")) {
    throw forbidden("پنل HRC برای این شرکت فعال نیست");
  }
  return { companyId: c.id, slug, schema: c.schema_name, name: c.name, modules };
}

async function tenantById(companyId: string): Promise<TenantRef> {
  const [c] = await sql<
    { id: string; slug: string; name: string; schema_name: string; status: string; modules: string[] | null }[]
  >`SELECT id, slug, name, schema_name, status, modules FROM platform.companies WHERE id = ${companyId}`;
  if (!c || c.status === "suspended") throw unauthorized("شرکت دیگر فعال نیست");
  const modules = normalizeModules(c.modules);
  if (!hasModule(modules, "hrc")) {
    throw forbidden("پنل HRC برای این شرکت فعال نیست");
  }
  return { companyId: c.id, slug: c.slug, schema: c.schema_name, name: c.name, modules };
}

/* ─────────────────────────────── enrolment ticket ────────────────────────── */

/**
 * The ticket is `<slug>.<random>` so the enrol call does not need a separate
 * slug field, and only its hash is stored.
 */
export function makeTicket(slug: string): { ticket: string; hash: string } {
  const ticket = `${slug}.${randomBytes(24).toString("base64url")}`;
  return { ticket, hash: sha256(ticket) };
}

export function splitTicket(ticket: string): { slug: string } {
  const i = ticket.indexOf(".");
  if (i < 1) throw unauthorized("بلیت ثبت‌نام معتبر نیست");
  return { slug: ticket.slice(0, i) };
}

export async function issueTicket(
  tenant: TenantRef,
  memberId: string,
  ip: string | null
): Promise<{ ticket: string; expiresAt: string }> {
  const { ticket, hash } = makeTicket(tenant.slug);
  const expiresAt = new Date(Date.now() + TICKET_TTL_MIN * 60_000);
  await withTenant(tenant.schema, async (tx) => {
    // one live ticket per member — asking for a new one invalidates the old
    await tx`
      UPDATE hrc_enrolment_tickets SET used_at = now()
      WHERE member_id = ${memberId} AND used_at IS NULL
    `;
    await tx`
      INSERT INTO hrc_enrolment_tickets (token_hash, member_id, issued_ip, expires_at)
      VALUES (${hash}, ${memberId}, ${ip}, ${expiresAt})
    `;
  });
  return { ticket, expiresAt: expiresAt.toISOString() };
}

/** Consume a ticket. Single-use: the same ticket never enrols twice. */
export async function redeemTicket(
  tx: import("postgres").TransactionSql,
  ticket: string
): Promise<{ memberId: string; ticketId: string }> {
  const [row] = await tx<{ id: string; member_id: string }[]>`
    UPDATE hrc_enrolment_tickets
    SET used_at = now()
    WHERE token_hash = ${sha256(ticket)}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING id, member_id
  `;
  if (!row) throw unauthorized("بلیت ثبت‌نام نامعتبر یا منقضی شده است");
  return { memberId: row.member_id, ticketId: row.id };
}

/* ──────────────────────────────── device token ───────────────────────────── */

export interface DeviceClaims {
  sub: string; // members.id
  did: string; // hrc_devices.id
  aud: string; // device_uid
  tenant: string; // platform.companies.id
  ver: number; // token_version — bumped to revoke every issued token
  typ: "hrc-device";
}

export async function signDeviceToken(c: Omit<DeviceClaims, "typ">): Promise<string> {
  return new SignJWT({ ...c, typ: "hrc-device" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_TOKEN_DAYS}d`)
    .sign(deviceSecret());
}

export interface DeviceContext extends TenantRef {
  deviceId: string;
  deviceUid: string;
  deviceType: string;
  memberId: string;
  memberName: string;
}

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Authenticate a device request. Revocation is checked against the row on
 * every call, so suspending a device takes effect immediately — the 30-day
 * token does not outlive the decision.
 */
export async function authenticateDevice(req: Request): Promise<DeviceContext> {
  const token = bearer(req);
  if (!token) throw unauthorized("توکن دستگاه ارسال نشده است");

  let claims: DeviceClaims;
  try {
    const { payload } = await jwtVerify(token, deviceSecret());
    claims = payload as unknown as DeviceClaims;
  } catch {
    throw unauthorized("توکن دستگاه نامعتبر یا منقضی است");
  }
  if (claims.typ !== "hrc-device") throw unauthorized("نوع توکن برای دستگاه نیست");

  const tenant = await tenantById(claims.tenant);
  const ctx = await withTenant(tenant.schema, async (tx) => {
    const [d] = await tx<
      { id: string; device_uid: string; device_type: string; status: string; token_version: number }[]
    >`
      SELECT id, device_uid, device_type, status, token_version
      FROM hrc_devices WHERE id = ${claims.did}
    `;
    if (!d) return null;
    if (d.status !== "ACTIVE") {
      throw new HrcError(403, "device_revoked", "این دستگاه غیرفعال شده است");
    }
    if (d.token_version !== claims.ver) {
      throw unauthorized("توکن دستگاه باطل شده است؛ دوباره وارد شوید");
    }
    const [m] = await tx<{ id: string; full_name: string; status: string }[]>`
      SELECT id, full_name, status FROM members WHERE id = ${claims.sub}
    `;
    if (!m || m.status !== "active") {
      throw new HrcError(403, "member_inactive", "کاربر این دستگاه فعال نیست");
    }
    return {
      deviceId: d.id,
      deviceUid: d.device_uid,
      deviceType: d.device_type,
      memberId: m.id,
      memberName: m.full_name,
    };
  });
  if (!ctx) throw unauthorized("دستگاه یافت نشد");
  return { ...tenant, ...ctx };
}

/* ───────────────────────── challenge / response refresh ──────────────────── */

export async function issueChallenge(
  tenant: TenantRef,
  deviceId: string
): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000);
  await withTenant(tenant.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_device_challenges (device_id, nonce, expires_at)
      VALUES (${deviceId}, ${nonce}, ${expiresAt})
    `;
  });
  return { nonce, expiresAt: expiresAt.toISOString() };
}

/**
 * Verify a signature made by the device's Keystore key over the nonce.
 * Supports the two shapes Android Keystore actually produces: EC P-256 with
 * SHA256withECDSA (DER signature) and Ed25519.
 */
export function verifySignature(
  publicKeyDerB64: string,
  algorithm: string | null,
  message: string,
  signatureB64: string
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyDerB64, "base64"),
      format: "der",
      type: "spki",
    });
    const sig = Buffer.from(signatureB64, "base64");
    const msg = Buffer.from(message, "utf8");
    const alg = (algorithm || key.asymmetricKeyType || "").toLowerCase();
    if (alg.includes("ed25519")) return cryptoVerify(null, msg, key, sig);
    return cryptoVerify("sha256", msg, key, sig);
  } catch {
    return false;
  }
}

/** Consume a challenge — single-use, so a captured signature cannot be replayed. */
export async function redeemChallenge(
  tx: import("postgres").TransactionSql,
  deviceId: string,
  nonce: string
): Promise<void> {
  const [row] = await tx<{ id: string }[]>`
    UPDATE hrc_device_challenges SET used_at = now()
    WHERE device_id = ${deviceId} AND nonce = ${nonce}
      AND used_at IS NULL AND expires_at > now()
    RETURNING id
  `;
  if (!row) throw unauthorized("چالش نامعتبر یا منقضی شده است");
}
