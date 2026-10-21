import { commsCall } from "@/lib/comms";

export const dynamic = "force-dynamic";

/** GET my recent calls; POST {to, video} rings them. */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  return commsCall(params.slug, "GET", `/v1/tenants/${encodeURIComponent(params.slug)}/calls?limit=30`);
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const body = await req.json().catch(() => ({}));
  return commsCall(params.slug, "POST", `/v1/tenants/${encodeURIComponent(params.slug)}/calls`, {
    to: Array.isArray(body?.to) ? body.to : [],
    video: body?.video === true,
  });
}
