import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { toFaDigits, todayJalali } from "@/lib/jalali";
import { LeaveForm } from "./LeaveForm";
import { cancelLeaveAction } from "./actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, faDate } from "./shared";

interface Req {
  id: string;
  kind: string;
  from_date: string;
  to_date: string;
  from_time: string | null;
  to_time: string | null;
  reason: string | null;
  status: string;
}

export default async function LeavePage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const requests = await withTenant(ctx.company.schema, async (tx) =>
    tx<Req[]>`
      SELECT id, kind, from_date::text, to_date::text, from_time, to_time,
             reason, status
      FROM leave_requests WHERE member_id = ${ctx.member.memberId}
      ORDER BY created_at DESC
    `
  );

  return (
    <>
      <PageHeader
        title="مرخصی و مأموریت"
        description="ثبت درخواست و پیگیری وضعیت آن"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LeaveForm slug={params.slug} year={todayJalali().jy} />

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            درخواست‌های من
          </h3>
          {requests.length === 0 ? (
            <div className="text-sm text-slate-400">درخواستی ثبت نشده است.</div>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-100 px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-slate-100 text-slate-600">
                        {KIND_LABEL[r.kind]}
                      </span>
                      <span className={`badge ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    {r.status === "pending" && (
                      <form action={cancelLeaveAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-red-600 hover:underline">
                          لغو
                        </button>
                      </form>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {r.kind === "hourly" ? (
                      <span>
                        {faDate(r.from_date)} — ساعت {toFaDigits(r.from_time ?? "")} تا{" "}
                        {toFaDigits(r.to_time ?? "")}
                      </span>
                    ) : (
                      <span>
                        از {faDate(r.from_date)} تا {faDate(r.to_date)}
                      </span>
                    )}
                    {r.reason && <span className="mr-2">— {r.reason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
