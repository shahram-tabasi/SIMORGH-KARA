import "server-only";
import { oidcConfig } from "@/lib/oidc";

/**
 * kara-api, called from kara-web's server code for the signed-in person:
 * kara-web's own service-account token (client kara-web, realm kara) plus
 * X-Kara-Account. kara-api checks that account's rights itself.
 *
 *   KARA_API_URL  http://kara-api:3001 (inside the cluster)
 */

let cached: { token: string; until: number } | undefined;

async function serviceToken(): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const c = oidcConfig();
  if (!c) throw new KaraApiError(503, "Keycloak is not configured for kara-web");
  const res = await fetch(`${c.internal}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.secret }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new KaraApiError(503, `token for kara-web: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + Math.max(body.expires_in - 30, 10) * 1000 };
  return cached.token;
}

export class KaraApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export const karaApiEnabled = () => !!process.env.KARA_API_URL && !!oidcConfig();

export async function karaApi<T>(
  accountId: string,
  method: string,
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const base = (process.env.KARA_API_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new KaraApiError(503, "KARA_API_URL is not set");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await serviceToken()}`,
        "x-kara-account": accountId,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof KaraApiError) throw e;
    throw new KaraApiError(503, "سرویس در دسترس نیست؛ کمی بعد دوباره تلاش کنید.");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join("، ") : String(body?.message ?? `HTTP ${res.status}`);
    throw new KaraApiError(res.status, message, body?.code);
  }
  return body as T;
}

/**
 * After an account is created or changed: its Keycloak user and organization,
 * and an email to set a password for a new one. Best effort: the account
 * exists in Kara either way, and `npm run`/cli import-identities catches up.
 */
export async function syncIdentity(actorAccountId: string, accountId: string): Promise<string | null> {
  if (!karaApiEnabled()) return null;
  try {
    const r = await karaApi<{ invited: boolean; note?: string }>(actorAccountId, "POST", `/v1/identity/accounts/${accountId}/sync`, { body: { invite: true } });
    if (r.note) return r.note;
    return null;
  } catch (e) {
    return `ثبت در سامانهٔ ورود انجام نشد: ${(e as Error).message}`;
  }
}
