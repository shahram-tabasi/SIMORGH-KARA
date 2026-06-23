import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { toFaDigits } from "@/lib/jalali";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, faDate } from "../shared";
import { decideLeaveAction } from "../actions";

interface Row {
  id: string;
  member_name: string;
  kind: string;
  from_date: string;
  to_date: string;
  from_time: string | null;
  to_time: string | null;
  reason: string | null;
  status: string;
}

async function loadRequests(schema: string) {
  return withTenant(schema, async (tx) => {
    const pending = await tx<Row[]>`
      SELECT lr.id, m.full_name AS member_name, lr.kind,
             lr.from_date::text, lr.to_date::text, lr.from_time, lr.to_time,
             lr.reason, lr.status
      FROM leave_requests lr JOIN members m ON m.id = lr.member_id
      WHERE lr.status = 'pending'
      ORDER BY lr.created_at
    `;
    const history = await tx<Row[]>`
      SELECT lr.id, m.full_name AS member_name, lr.kind,
             lr.from_date::text, lr.to_date::text, lr.from_time, lr.to_time,
             lr.reason, lr.status
      FROM leave_requests lr JOIN members m ON m.id = lr.member_id
      WHERE lr.status <> 'pending'
      ORDER BY lr.decided_at DESC NULLS LAST
      LIMIT 50
    `;
    return { pending, history };
  });
}

function Range({ r }: { r: Row }) {
  if (r.kind === "hourly") {
    return (
      <span>
        {faDate(r.from_date)} — ساعت {toFaDigits(r.from_time ?? "")} تا{" "}
        {toFaDigits(r.to_time ?? "")}
      </span>
    );
  }
  return (
    <span>
      از {faDate(r.from_date)} تا {faDate(r.to_date)}
    </span>
  );
}

export default async function LeaveManagePage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "leave.approve");
  const { pending, history } = await loadRequests(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="تأیید مرخصی‌ها"
        description="بررسی و تصمیم‌گیری درباره درخواست‌های اعضا"
      />

      <div className="card mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          در انتظار تأیید ({toFaDigits(pending.length)})
        </h3>
        {pending.length === 0 ? (
          <div className="text-sm text-slate-400">درخواست بازی وجود ندارد.</div>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-700">
                      {r.member_name}
                    </span>
                    <span className="badge bg-slate-100 text-slate-600">
                      {KIND_LABEL[r.kind]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    <Range r={r} />
                    {r.reason && <span className="mr-2">— {r.reason}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={decideLeaveAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <button className="btn-primary px-3 py-1 text-xs">تأیید</button>
                  </form>
                  <form action={decideLeaveAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <button className="btn-danger px-3 py-1 text-xs">رد</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">سوابق اخیر</h3>
        {history.length === 0 ? (
          <div className="text-sm text-slate-400">سابقه‌ای وجود ندارد.</div>
        ) : (
          <ul className="space-y-2">
            {history.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-slate-700">
                    {r.member_name}
                  </span>
                  <span className="mr-2 text-xs text-slate-500">
                    {KIND_LABEL[r.kind]} — <Range r={r} />
                  </span>
                </div>
                <span className={`badge ${STATUS_TONE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
