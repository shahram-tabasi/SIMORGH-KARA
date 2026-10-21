import "server-only";
import { NextResponse } from "next/server";
import { getSession, type SessionData } from "@/lib/auth";
import { karaApi, KaraApiError, karaApiEnabled } from "@/lib/kara-api";

/** The signed-in member of `slug` for a route handler: no redirect, a 401 instead. */
export async function tenantSession(slug: string): Promise<SessionData | null> {
  const s = await getSession();
  if (!s || s.kind !== "tenant" || s.slug !== slug) return null;
  return s;
}

/** Proxy one JSON call to kara-api for the signed-in member, errors as JSON. */
export async function commsCall(slug: string, method: string, path: string, body?: unknown): Promise<NextResponse> {
  const s = await tenantSession(slug);
  if (!s) return NextResponse.json({ message: "وارد نشده‌اید" }, { status: 401 });
  if (!karaApiEnabled()) return NextResponse.json({ message: "تماس و جلسه روی این نصب فعال نیست" }, { status: 503 });
  try {
    return NextResponse.json(await karaApi(s.sub, method, path, body !== undefined ? { body } : {}));
  } catch (e) {
    const status = e instanceof KaraApiError ? e.status : 500;
    return NextResponse.json({ message: e instanceof Error ? e.message : "خطا" }, { status });
  }
}
