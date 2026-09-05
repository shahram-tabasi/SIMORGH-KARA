import { apiRoute } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/finance/trial-balance — تراز آزمایشی اسناد قطعی. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "finance", "finance.reports.view", async (tx) =>
    tx`
      SELECT a.code, a.name, a.type,
             COALESCE(sum(l.debit), 0)  AS debit,
             COALESCE(sum(l.credit), 0) AS credit
      FROM ledger_accounts a
      JOIN ledger_lines l ON l.account_id = a.id
      JOIN ledger_entries e ON e.id = l.entry_id AND e.status = 'posted'
      GROUP BY a.code, a.name, a.type
      ORDER BY a.code
    `
  );
}
