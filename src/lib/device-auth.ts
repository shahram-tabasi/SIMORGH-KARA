import "server-only";
import { sql } from "./db";

/** Resolve a tenant schema from its slug (null if missing/suspended). */
export async function resolveTenantSchema(slug: string): Promise<string | null> {
  const [c] = await sql<{ schema_name: string; status: string }[]>`
    SELECT schema_name, status FROM platform.companies WHERE slug = ${slug}
  `;
  if (!c || c.status === "suspended") return null;
  return c.schema_name;
}

/** Extract a device token from Authorization: Bearer or x-device-token. */
export function deviceToken(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-device-token") || "";
}

/** Map a device kind to the punch source label. */
export function sourceForKind(kind: string): string {
  return kind === "guard" ? "guard" : kind === "mobile" ? "mobile" : "device";
}
