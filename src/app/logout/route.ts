import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function GET(request: Request) {
  destroySession();
  return NextResponse.redirect(new URL("/login", request.url));
}
