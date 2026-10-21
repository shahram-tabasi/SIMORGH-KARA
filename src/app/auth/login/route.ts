import { NextResponse } from "next/server";
import { appUrl, authorizeUrl, newPendingLogin, oidcEnabled } from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /auth/login[?org=<tenant slug>][&next=/app/…] — off to Keycloak.
 * `org` is a tenant's own login page (/c/<slug>): Keycloak signs in for that
 * organization and offers its identity provider (Simorgh staff).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appUrl(request);
  if (!oidcEnabled()) return NextResponse.redirect(`${base}/login`);
  const org = url.searchParams.get("org") ?? undefined;
  const next = url.searchParams.get("next") ?? undefined;
  const pending = newPendingLogin(next && next.startsWith("/") && !next.startsWith("//") ? next : undefined);
  const res = NextResponse.redirect(
    authorizeUrl(pending, `${base}/auth/callback`, { organization: org && /^[a-z0-9-]{1,60}$/.test(org) ? org : undefined }),
  );
  res.cookies.set("sk_oidc", JSON.stringify(pending), {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/auth",
    maxAge: 600,
  });
  return res;
}
