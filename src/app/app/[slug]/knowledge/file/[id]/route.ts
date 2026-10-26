import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";

/**
 * The original of an uploaded knowledge document: for whoever may see the
 * company's knowledge, and for every member the rules and circulars that
 * apply to them (the company's, their units' and the units' above), as
 * «دستیار هوش مصنوعی» lists them.
 */
export async function GET(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const ctx = await requireTenant(params.slug);
  const all = ctx.member.permissions.has("knowledge.view") || ctx.member.permissions.has("knowledge.manage");
  const [f] = await withTenant(ctx.company.schema, (tx) => all
    ? tx<{ file_name: string; file_mime: string | null; file_data: Buffer }[]>`
        SELECT file_name, file_mime, file_data FROM knowledge WHERE id = ${params.id} AND file_data IS NOT NULL`
    : tx<{ file_name: string; file_mime: string | null; file_data: Buffer }[]>`
        WITH RECURSIVE up AS (
          SELECT g.id, g.parent_id FROM groups g JOIN member_groups mg ON mg.group_id = g.id WHERE mg.member_id = ${ctx.member.memberId}
          UNION SELECT g.id, g.parent_id FROM groups g JOIN up ON g.id = up.parent_id
        )
        SELECT file_name, file_mime, file_data FROM knowledge
        WHERE id = ${params.id} AND file_data IS NOT NULL AND active AND kind IN ('hr_rule','order','other')
          AND (unit_id IS NULL OR unit_id IN (SELECT id FROM up))`);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(f.file_data), {
    headers: {
      "content-type": f.file_mime || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      "cache-control": "private, no-store",
    },
  });
}
