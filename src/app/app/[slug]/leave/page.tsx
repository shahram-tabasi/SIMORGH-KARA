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
  type_name: string | null;
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
  const { requests, types } = await withTenant(ctx.company.schema, async (tx) => {
    const requests = await tx<Req[]>`
      SELECT lr.id, lr.kind, lt.name AS type_name, lr.from_date::text,
             lr.to_date::text, lr.from_time, lr.to_time, lr.reason, lr.status
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lt.id = lr.type_id
      WHERE lr.member_id = ${ctx.member.memberId}
      ORDER BY lr.created_at DESC
    `;
    const types = await tx<
      {
        id: string;
        name: string;
        unit: "day" | "hour";
        requires_attachment: boolean;
        description: string | null;
      }[]
    >`
      SELECT id, name, unit, requires_attachment, description
      FROM leave_types WHERE is_active = true ORDER BY sort_order, name
    `;
    return { requests, types };
  });

  return (
    <>
      <PageHeader
        title="مرخصی و مأموریت"
        description="ثبت درخواست و پیگیری وضعیت آن"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LeaveForm slug={params.slug} year={todayJalali().jy} types={types} />

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
                        {r.type_name ?? KIND_LABEL[r.kind]}
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
