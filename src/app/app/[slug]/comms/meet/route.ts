import { commsCall } from "@/lib/comms";

export const dynamic = "force-dynamic";

/** POST {topic}: a token for the record's meeting room (company, project-12…). */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const body = await req.json().catch(() => ({}));
  return commsCall(params.slug, "POST", `/v1/tenants/${encodeURIComponent(params.slug)}/meet`, {
    topic: typeof body?.topic === "string" ? body.topic : "company",
  });
}
