"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";
import { logoutUrl, oidcEnabled } from "@/lib/oidc";

/**
 * Log out via POST only. A destructive GET route would be triggered by
 * Next.js link prefetching (logging users out as soon as the logout link
 * entered the viewport), so logout must be an explicit form submission.
 *
 * With Keycloak, its single sign-on ends too (otherwise the next "sign in"
 * would come straight back without asking).
 */
export async function logoutAction() {
  destroySession();
  if (oidcEnabled()) {
    const idToken = cookies().get("sk_idt")?.value;
    cookies().delete("sk_idt");
    const h = headers();
    const base = process.env.APP_URL?.replace(/\/+$/, "") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    redirect(logoutUrl(idToken, `${base}/login`));
  }
  redirect("/login");
}
