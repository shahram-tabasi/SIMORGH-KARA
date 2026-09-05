import { apiRoute, limitOf, param } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/<slug>/v1/finance/entries?status=posted&from=&to=
 * اسناد حسابداری به‌همراه آرتیکل‌ها.
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "finance", "ledger.view", async (tx) => {
    const status = param(req, "status");
    const from = param(req, "from");
    const to = param(req, "to");
    const limit = limitOf(req, 200);

    const entries = await tx<{ id: string }[]>`
      SELECT e.id, e.number, e.entry_date::text, e.description, e.status,
             e.ref_kind, e.ref_id, e.posted_at::text
      FROM ledger_entries e
      WHERE ${status ? tx`e.status = ${status}` : tx`true`}
        AND ${from ? tx`e.entry_date >= ${from}::date` : tx`true`}
        AND ${to ? tx`e.entry_date <= ${to}::date` : tx`true`}
      ORDER BY e.entry_date DESC, e.number DESC NULLS LAST
      LIMIT ${limit}
    `;
    if (entries.length === 0) return [];
    const ids = entries.map((e) => e.id);
    const lines = await tx<{ entry_id: string }[]>`
      SELECT l.entry_id, a.code AS account_code, a.name AS account_name,
             l.debit, l.credit, l.description
      FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      WHERE l.entry_id = ANY(${ids})
      ORDER BY l.sort_order
    `;
    return entries.map((e) => ({
      ...e,
      lines: lines.filter((l) => l.entry_id === e.id),
    }));
  });
}
