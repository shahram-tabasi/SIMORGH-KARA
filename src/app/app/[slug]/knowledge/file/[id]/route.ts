import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";

/** The original of an uploaded knowledge document, for whoever may see the company's knowledge. */
export async function GET(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const ctx = await requireTenant(params.slug);
  if (!ctx.member.permissions.has("knowledge.view") && !ctx.member.permissions.has("knowledge.manage")) {
    return new Response("forbidden", { status: 403 });
  }
  const [f] = await withTenant(ctx.company.schema, (tx) => tx<{ file_name: string; file_mime: string | null; file_data: Buffer }[]>`
    SELECT file_name, file_mime, file_data FROM knowledge WHERE id = ${params.id} AND file_data IS NOT NULL`);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(f.file_data), {
    headers: {
      "content-type": f.file_mime || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      "cache-control": "private, no-store",
    },
  });
}
