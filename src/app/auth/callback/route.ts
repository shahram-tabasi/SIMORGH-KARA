import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountByEmail, startSession } from "@/lib/login";
import { appUrl, finishLogin, logoutUrl, type PendingLogin } from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /auth/callback?code&state — back from Keycloak. The verified email
 * names the Kara account; the session is the one a password login makes.
 * Failures go to /login?error=<code> (the page says what it means).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appUrl(request);
  const fail = (code: string, signOut?: string) => {
    // Signed in at Keycloak but not in Kara: end the Keycloak session too, so
    // the next attempt can use another account.
    const to = `${base}/login?error=${code}`;
    const res = NextResponse.redirect(signOut ? logoutUrl(signOut, to) : to);
    res.cookies.delete({ name: "sk_oidc", path: "/auth" });
    return res;
  };

  if (url.searchParams.get("error")) return fail("cancelled");
  let pending: PendingLogin;
  try {
    pending = JSON.parse(cookies().get("sk_oidc")?.value ?? "");
  } catch {
    return fail("expired");
  }
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== pending.state) return fail("expired");

  let claims, idToken;
  try {
    ({ claims, idToken } = await finishLogin(code, pending, `${base}/auth/callback`));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", context: "auth/callback", message: (e as Error).message }));
    return fail("keycloak");
  }
  if (!claims.email || claims.email_verified !== true) return fail("unverified", idToken);

  const account = await accountByEmail(claims.email);
  if (!account) return fail("no_account", idToken);
  const outcome = await startSession(account);
  if ("error" in outcome) return fail(account.status !== "active" ? "disabled" : "company", idToken);

  const res = NextResponse.redirect(`${base}${pending.next ?? outcome.redirectTo}`);
  res.cookies.delete({ name: "sk_oidc", path: "/auth" });
  // For Keycloak's logout (id_token_hint): ends the single sign-on as well.
  res.cookies.set("sk_idt", idToken, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
