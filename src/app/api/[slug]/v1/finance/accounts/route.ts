import { apiRoute, limitOf } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/finance/accounts — کدینگ حساب‌ها با گردش قطعی. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "finance", "ledger.view", async (tx) => {
    const limit = limitOf(req, 500);
    return tx`
      SELECT a.id, a.code, a.name, a.type, a.level, a.is_group, a.is_active,
             COALESCE((SELECT sum(l.debit) FROM ledger_lines l
                       JOIN ledger_entries e ON e.id = l.entry_id
                       WHERE l.account_id = a.id AND e.status = 'posted'), 0) AS debit,
             COALESCE((SELECT sum(l.credit) FROM ledger_lines l
                       JOIN ledger_entries e ON e.id = l.entry_id
                       WHERE l.account_id = a.id AND e.status = 'posted'), 0) AS credit
      FROM ledger_accounts a ORDER BY a.code LIMIT ${limit}
    `;
  });
}
