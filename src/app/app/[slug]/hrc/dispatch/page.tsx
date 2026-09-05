import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DISPATCH_STATUS, ALERT_KINDS } from "@/lib/hrc";
import { setDispatchStatusAction } from "../actions";

interface Row {
  id: string;
  status: string;
  priority: string;
  team: string | null;
  target: string | null;
  alert_id: string | null;
  alert_kind: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  outcome: string | null;
  dispatcher: string | null;
  dispatched_at: string;
  enroute_at: string | null;
  onsite_at: string | null;
  closed_at: string | null;
}

const tone: Record<string, string> = {
  dispatched: "bg-amber-100 text-amber-700",
  enroute: "bg-blue-100 text-blue-700",
  onsite: "bg-indigo-100 text-indigo-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-slate-100 text-slate-500",
};

async function load(schema: string, status: string) {
  return withTenant(schema, async (tx) =>
    tx<Row[]>`
      SELECT d.id, d.status, d.priority, t.name AS team, m.full_name AS target,
             d.alert_id, a.kind AS alert_kind, z.name AS zone, d.lat, d.lng,
             d.note, d.outcome, db.full_name AS dispatcher,
             d.dispatched_at::text, d.enroute_at::text, d.onsite_at::text,
             d.closed_at::text
      FROM hrc_dispatches d
      LEFT JOIN hrc_teams t ON t.id = d.team_id
      LEFT JOIN members m ON m.id = d.target_member_id
      LEFT JOIN members db ON db.id = d.dispatched_by
      LEFT JOIN hrc_alerts a ON a.id = d.alert_id
      LEFT JOIN hrc_zones z ON z.id = d.zone_id
      WHERE ${
        status === "active"
          ? tx`d.status IN ('dispatched','enroute','onsite')`
          : status === "all"
            ? tx`true`
            : tx`d.status = ${status}`
      }
      ORDER BY d.dispatched_at DESC
      LIMIT 200
    `
  );
}

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { status?: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.monitor", "hrc.dispatch", "hrc.teams.manage");
  const canDispatch = ctx.member.permissions.has("hrc.dispatch");
  const status = searchParams.status ?? "active";
  const rows = await load(ctx.company.schema, status);
  const base = `/app/${params.slug}/hrc`;

  return (
    <>
      <PageHeader
        title="اعزام تیم HRC"
        description="مأموریت‌های اعزام، زمان‌بندی رسیدن به محل و نتیجهٔ هر مأموریت"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["active", "در جریان"],
          ["all", "همه"],
          ["done", DISPATCH_STATUS.done],
          ["cancelled", DISPATCH_STATUS.cancelled],
        ].map(([k, label]) => (
          <Link
            key={k}
            href={`${base}/dispatch?status=${k}`}
            className={`badge ${
              status === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="card text-sm text-slate-400">اعزامی در این نما وجود ندارد.</div>
        ) : (
          rows.map((d) => (
            <div key={d.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      {d.team ?? "تیم حذف‌شده"}
                    </span>
                    <span className={`badge ${tone[d.status]}`}>
                      {DISPATCH_STATUS[d.status as keyof typeof DISPATCH_STATUS]}
                    </span>
                    <span
                      className={`badge ${
                        d.priority === "critical"
                          ? "bg-red-100 text-red-700"
                          : d.priority === "high"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {d.priority === "critical" ? "بحرانی" : d.priority === "high" ? "فوری" : "عادی"}
                    </span>
                    {d.alert_id && (
                      <Link
                        href={`${base}/alerts?status=all`}
                        className="badge bg-blue-50 text-blue-700"
                      >
                        {ALERT_KINDS[d.alert_kind as keyof typeof ALERT_KINDS] ?? "هشدار"}
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    هدف: {d.target ?? "—"}
                    {d.zone ? ` · ناحیه ${d.zone}` : ""}
                    {d.lat !== null && d.lng !== null
                      ? ` · ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`
                      : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    اعزام‌کننده: {d.dispatcher ?? "سیستم"} ·{" "}
                    {d.dispatched_at.slice(0, 16).replace("T", " ")}
                    {d.enroute_at ? ` · حرکت ${d.enroute_at.slice(11, 16)}` : ""}
                    {d.onsite_at ? ` · رسیدن ${d.onsite_at.slice(11, 16)}` : ""}
                    {d.closed_at ? ` · پایان ${d.closed_at.slice(11, 16)}` : ""}
                  </div>
                  {d.note && <div className="mt-1 text-xs text-slate-600">{d.note}</div>}
                  {d.outcome && (
                    <div className="mt-1 text-xs text-green-700">نتیجه: {d.outcome}</div>
                  )}
                </div>

                {canDispatch && !["done", "cancelled"].includes(d.status) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {d.status === "dispatched" && (
                      <form action={setDispatchStatusAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="dispatchId" value={d.id} />
                        <input type="hidden" name="status" value="enroute" />
                        <button className="btn-ghost">در مسیر</button>
                      </form>
                    )}
                    {["dispatched", "enroute"].includes(d.status) && (
                      <form action={setDispatchStatusAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="dispatchId" value={d.id} />
                        <input type="hidden" name="status" value="onsite" />
                        <button className="btn-ghost">رسیدن به محل</button>
                      </form>
                    )}
                    <form action={setDispatchStatusAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="dispatchId" value={d.id} />
                      <input type="hidden" name="status" value="done" />
                      <input
                        name="outcome"
                        placeholder="نتیجهٔ مأموریت"
                        className="input !w-36 !py-1 text-xs"
                      />
                      <button className="btn-primary">پایان</button>
                    </form>
                    <form action={setDispatchStatusAction}>
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="dispatchId" value={d.id} />
                      <input type="hidden" name="status" value="cancelled" />
                      <button className="btn-danger">لغو</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
