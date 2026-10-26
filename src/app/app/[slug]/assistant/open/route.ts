import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { handoffConfigured, handoffToken, hrAppUrl } from "@/lib/hr-handoff";

export const dynamic = "force-dynamic";

/**
 * GET /app/<slug>/assistant/open — into the HR assistant as this member
 * (src/lib/hr-handoff.ts). The token travels in the URL's fragment, which
 * browsers never send to a server, so no log keeps it.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  const back = (why: string) => NextResponse.redirect(new URL(`/app/${params.slug}/assistant?error=${why}`, _req.url), 303);
  const [company] = await sql<{ apps: Record<string, boolean> | null }[]>`SELECT apps FROM platform.companies WHERE id = ${ctx.company.id}`;
  if (!company?.apps?.hrChatbot) return back("off");
  if (!handoffConfigured()) return back("config");

  const person = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ title: string | null }[]>`SELECT title FROM members WHERE id = ${ctx.member.memberId}`;
    const units = await tx.unsafe<{ path: string }[]>(`
      WITH RECURSIVE t AS (
        SELECT id, name::text AS path FROM groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || ' / ' || g.name FROM groups g JOIN t ON g.parent_id = t.id
      ) SELECT t.path FROM t JOIN member_groups mg ON mg.group_id = t.id WHERE mg.member_id = $1 ORDER BY t.path`, [ctx.member.memberId]);
    return { title: m?.title ?? null, units: units.map((u) => u.path) };
  });
  const token = await handoffToken({
    accountId: ctx.session.sub, email: ctx.session.email, fullName: ctx.member.fullName, title: person.title,
    company: { slug: ctx.company.slug, name: ctx.company.name }, units: person.units,
  });
  return NextResponse.redirect(`${hrAppUrl()}/auth/kara#token=${encodeURIComponent(token)}`, 303);
}
