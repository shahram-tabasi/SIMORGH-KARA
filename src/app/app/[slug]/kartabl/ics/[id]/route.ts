import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { buildICS } from "@/lib/ics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Download a single kartabl item as an .ics calendar event (with a reminder
 * alarm). Importing it into Windows Calendar / Outlook / Google fires a native
 * reminder even when the browser is closed.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string; id: string } }
) {
  const ctx = await requireTenant(params.slug);

  const item = await withTenant(ctx.company.schema, async (tx) => {
    const [row] = await tx<
      { id: string; title: string; body: string | null; remind_at: Date | null; created_at: Date }[]
    >`
      SELECT i.id, i.title, i.body, i.remind_at, i.created_at
      FROM kartabl_items i
      JOIN kartabls k ON k.id = i.kartabl_id
      WHERE i.id = ${params.id} AND k.member_id = ${ctx.member.memberId}
    `;
    return row ?? null;
  });

  if (!item) {
    return new Response("not found", { status: 404 });
  }

  const start = item.remind_at ?? item.created_at;
  const ics = buildICS({
    uid: `kartabl-${item.id}@simorgh`,
    title: item.title,
    description: item.body ?? "یادآوری از کارتابل سیمرغ",
    start,
    durationMin: 30,
    alarmMinBefore: 0,
    stamp: new Date(),
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="reminder-${item.id}.ics"`,
    },
  });
}
