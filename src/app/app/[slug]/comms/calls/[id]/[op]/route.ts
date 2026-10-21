import { NextResponse } from "next/server";
import { commsCall } from "@/lib/comms";

export const dynamic = "force-dynamic";

const OPS = new Set(["accept", "decline", "leave"]);

/** Answer, decline or hang up a call. */
export async function POST(_req: Request, { params }: { params: { slug: string; id: string; op: string } }) {
  if (!OPS.has(params.op) || !/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ message: "not found" }, { status: 404 });
  return commsCall(params.slug, "POST", `/v1/calls/${params.id}/${params.op}`);
}
