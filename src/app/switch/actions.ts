"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { createSession, getSession } from "@/lib/auth";

/** From a company back to the platform panel — for an account that is a platform administrator. */
export async function openPlatformPanelAction() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [a] = await sql<{ is_platform_admin: boolean; status: string }[]>`
    SELECT is_platform_admin, status FROM platform.user_accounts WHERE id = ${session.sub}`;
  if (!a?.is_platform_admin || a.status !== "active") redirect("/");
  await createSession({ sub: session.sub, email: session.email, name: session.name, kind: "platform" });
  redirect("/admin");
}
