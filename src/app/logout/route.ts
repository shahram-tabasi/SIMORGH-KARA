import { NextResponse } from "next/server";

/**
 * GET /logout is intentionally NON-destructive: link prefetching would
 * otherwise hit it and destroy the session (logging users out the moment the
 * logout link entered the viewport). Real logout happens via the POST
 * `logoutAction`; a stray GET just bounces to the login page.
 */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
