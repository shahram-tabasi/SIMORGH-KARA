"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";

/**
 * Log out via POST only. A destructive GET route would be triggered by
 * Next.js link prefetching (logging users out as soon as the logout link
 * entered the viewport), so logout must be an explicit form submission.
 */
export async function logoutAction() {
  destroySession();
  redirect("/login");
}
