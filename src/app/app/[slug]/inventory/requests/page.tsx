import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { REQUEST_STATUS, formatQty } from "@/lib/inventory";
import { RequestForm } from "./RequestForm";
import {
  decideStockRequestAction,
  fulfillStockRequestAction,
} from "../actions";

interface Req {
  id: string;
  number: number | null;
  requester: string;
  requester_id: string;
  warehouse: string | null;
  needed_date: string | null;
  note: string | null;
  status: string;
  decision_note: string | null;
  created_at: string;
}

const tone: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  fulfilled: "bg-green-100 text-green-700",
};

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const requests = await tx<Req[]>`
      SELECT r.id, r.number, m.full_name AS requester, r.requester_id,
             w.name AS warehouse, r.needed_date::text, r.note, r.status,
             r.decision_note, r.created_at::text
      FROM stock_requests r
      JOIN members m ON m.id = r.requester_id
      LEFT JOIN warehouses w ON w.id = r.warehouse_id
      ORDER BY r.created_at DESC
      LIMIT 200
    `;
    const lines = await tx<
      { request_id: string; name: string; unit: string; qty: string; note: string | null }[]
    >`
      SELECT l.request_id, i.name, i.unit, l.qty, l.note
      FROM stock_request_lines l
      JOIN items i ON i.id = l.item_id
      ORDER BY i.name
    `;
    const warehouses = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM warehouses WHERE is_active = true ORDER BY code
    `;
    const items = await tx<{ id: string; code: string; name: string; unit: string }[]>`
      SELECT id, code, name, unit FROM items WHERE is_active = true ORDER BY code
    `;
    return { requests, lines, warehouses, items };
  });
}

export default async function RequestsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "inventory", "inventory.view");
  const canRequest = ctx.member.permissions.has("inventory.request");
  const canApprove = ctx.member.permissions.has("inventory.request.approve");
  const canIssue = ctx.member.permissions.has("inventory.issue");
  const { requests, lines, warehouses, items } = await load(ctx.company.schema);

  const linesOf = (id: string) => lines.filter((l) => l.request_id === id);
  // Without the approval key a person only sees their own requests.
  const visible = canApprove
    ? requests
    : requests.filter((r) => r.requester_id === ctx.member.memberId);

  return (
    <>
      <PageHeader
        title="درخواست کالا"
        description="کارکنان کالای موردنیاز را درخواست می‌کنند؛ پس از تأیید، حوالهٔ خروج به‌صورت پیش‌نویس صادر می‌شود"
      />

      {canRequest && (
        <div className="mb-6">
          <RequestForm slug={params.slug} warehouses={warehouses} items={items} />
        </div>
      )}

      <div className="space-y-3">
        {visible.length === 0 ? (
          <div className="card text-sm text-slate-400">درخواستی ثبت نشده است.</div>
        ) : (
          visible.map((r) => (
            <div key={r.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      درخواست شمارهٔ {r.number ?? "—"}
                    </span>
                    <span className={`badge ${tone[r.status]}`}>
                      {REQUEST_STATUS[r.status as keyof typeof REQUEST_STATUS]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {r.requester} · انبار {r.warehouse ?? "—"}
                    {r.needed_date ? ` · تاریخ نیاز ${r.needed_date}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "pending" && canApprove && (
                    <>
                      <form action={decideStockRequestAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <button className="btn-primary">تأیید</button>
                      </form>
                      <form action={decideStockRequestAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <input
                          name="note"
                          placeholder="علت رد"
                          className="input !w-32 !py-1 text-xs"
                        />
                        <button className="btn-danger">رد</button>
                      </form>
                    </>
                  )}
                  {r.status === "approved" && canIssue && (
                    <form action={fulfillStockRequestAction}>
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <button className="btn-ghost">صدور حوالهٔ خروج</button>
                    </form>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {linesOf(r.id).map((l, i) => (
                  <span key={i} className="badge bg-slate-100 text-slate-600">
                    {l.name}: {formatQty(l.qty)} {l.unit}
                  </span>
                ))}
              </div>
              {r.decision_note && (
                <div className="mt-2 text-xs text-red-600">توضیح: {r.decision_note}</div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
