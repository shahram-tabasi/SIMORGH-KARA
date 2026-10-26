import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";

/** A product's picture, for any member of the company (products are no secret inside it). */
export async function GET(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const ctx = await requireTenant(params.slug);
  const [f] = await withTenant(ctx.company.schema, (tx) => tx<{ image_mime: string; image_data: Buffer }[]>`
    SELECT image_mime, image_data FROM knowledge WHERE id = ${params.id} AND image_data IS NOT NULL`);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(f.image_data), {
    headers: { "content-type": f.image_mime, "cache-control": "private, max-age=86400" },
  });
}
