import "server-only";
import { createHash, randomBytes } from "crypto";
import { sql, withTenant } from "./db";
import { normalizeModules, type ModuleKey, hasModule } from "./modules";
import type { PermissionKey } from "./rbac";

/**
 * API-key authentication for the integration gateway (`/api/<slug>/v1/...`).
 *
 * یک نرم‌افزار بیرونی (مثلاً سیستم فروش یا BI شرکت) با کلید API به داده‌های
 * همان شرکت وصل می‌شود. کلید دقیقاً همان permission keyهای سامانه را به‌عنوان
 * scope دارد، بنابراین هرگز دسترسی بیشتری از یک کاربر با همان مجوزها ندارد.
 * فقط هش SHA-256 کلید ذخیره می‌شود؛ متن کلید یک بار هنگام ساخت نمایش داده می‌شود.
 */

export interface ApiContext {
  companyId: string;
  slug: string;
  schema: string;
  modules: ModuleKey[];
  keyId: string;
  keyName: string;
  scopes: Set<string>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a new key: returns the plaintext (shown once) and what to store. */
export function generateApiKey(): {
  token: string;
  prefix: string;
  hash: string;
} {
  const body = randomBytes(24).toString("base64url");
  const prefix = `sk_${randomBytes(3).toString("hex")}`;
  const token = `${prefix}_${body}`;
  return { token, prefix, hash: hashToken(token) };
}

function bearer(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  return (
    auth.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-api-key")?.trim() ||
    ""
  );
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Resolve the company from the URL slug and the API key from the request.
 * Throws `ApiError` with the right HTTP status — route handlers map it to JSON.
 */
export async function authenticateApi(
  req: Request,
  slug: string
): Promise<ApiContext> {
  const [company] = await sql<
    {
      id: string;
      schema_name: string;
      status: string;
      modules: string[] | null;
    }[]
  >`
    SELECT id, schema_name, status, modules
    FROM platform.companies WHERE slug = ${slug}
  `;
  if (!company || company.status === "suspended") {
    throw new ApiError("tenant not found", 404);
  }
  const modules = normalizeModules(company.modules);
  if (!hasModule(modules, "api")) {
    throw new ApiError("api panel is not enabled for this company", 403);
  }

  const token = bearer(req);
  if (!token) throw new ApiError("missing api key", 401);
  const hash = hashToken(token);

  const key = await withTenant(company.schema_name, async (tx) => {
    const [k] = await tx<
      {
        id: string;
        name: string;
        scopes: string[];
        is_active: boolean;
        expires_at: string | null;
      }[]
    >`
      SELECT id, name, scopes, is_active, expires_at
      FROM api_keys WHERE token_hash = ${hash}
    `;
    if (!k || !k.is_active) return null;
    if (k.expires_at && new Date(k.expires_at) < new Date()) return null;
    await tx`
      UPDATE api_keys
      SET last_used_at = now(), call_count = call_count + 1
      WHERE id = ${k.id}
    `;
    return k;
  });
  if (!key) throw new ApiError("invalid or expired api key", 401);

  return {
    companyId: company.id,
    slug,
    schema: company.schema_name,
    modules,
    keyId: key.id,
    keyName: key.name,
    scopes: new Set(key.scopes ?? []),
  };
}

/** Guard one endpoint: the key must carry the panel *and* the permission. */
export function requireScope(
  ctx: ApiContext,
  module: ModuleKey,
  scope: PermissionKey
): void {
  if (!hasModule(ctx.modules, module)) {
    throw new ApiError(`module '${module}' is not enabled for this company`, 403);
  }
  if (!ctx.scopes.has(scope)) {
    throw new ApiError(`api key is missing scope '${scope}'`, 403);
  }
}
