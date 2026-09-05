import { NextResponse } from "next/server";
import { ApiError, authenticateApi, requireScope, type ApiContext } from "@/lib/api-auth";
import { withTenant, type Tx } from "@/lib/db";
import type { ModuleKey } from "@/lib/modules";
import type { PermissionKey } from "@/lib/rbac";

/**
 * Shared wrapper for every `/api/<slug>/v1/...` endpoint: authenticate the API
 * key, check the panel + scope, then run the handler inside the tenant schema.
 * `ApiError`s become the right HTTP status instead of a 500.
 */
export async function apiRoute<T>(
  req: Request,
  slug: string,
  module: ModuleKey,
  scope: PermissionKey,
  handler: (tx: Tx, ctx: ApiContext) => Promise<T>
): Promise<NextResponse> {
  try {
    const ctx = await authenticateApi(req, slug);
    requireScope(ctx, module, scope);
    const data = await withTenant(ctx.schema, (tx) => handler(tx, ctx));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected error" },
      { status: 500 }
    );
  }
}

/** Clamp a `limit` query parameter into a sane range. */
export function limitOf(req: Request, fallback = 200, max = 1000): number {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

export function param(req: Request, name: string): string | null {
  return new URL(req.url).searchParams.get(name);
}
