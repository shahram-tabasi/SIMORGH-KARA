import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Due reminders for the current member — consumed by the in-app ReminderWatcher
 * to show on-screen popups / browser notifications. Returns items whose
 * remind_at has passed within the last day and are not yet done.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireTenant(params.slug);
  const items = await withTenant(ctx.company.schema, async (tx) =>
    tx<{ id: string; title: string; body: string | null; remind_at: string }[]>`
      SELECT i.id, i.title, i.body, i.remind_at::text
      FROM kartabl_items i
      JOIN kartabls k ON k.id = i.kartabl_id
      WHERE k.member_id = ${ctx.member.memberId}
        AND i.remind_at IS NOT NULL
        AND i.remind_at <= now()
        AND i.remind_at > now() - interval '1 day'
        AND i.status NOT IN ('done', 'archived')
      ORDER BY i.remind_at DESC
    `
  );
  return NextResponse.json({ items });
}
