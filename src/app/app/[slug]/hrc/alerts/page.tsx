import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ALERT_KINDS, ALERT_STATUS, SEVERITY, SEVERITY_TONE } from "@/lib/hrc";
import { setAlertStatusAction, dispatchTeamAction } from "../actions";
import { ManualAlertForm } from "./ManualAlertForm";

interface AlertRow {
  id: string;
  member_id: string | null;
  member: string | null;
  kind: string;
  severity: string;
  status: string;
  message: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  acked_by_name: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  dispatches: number;
}

const statusTone: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  ack: "bg-amber-100 text-amber-700",
  dispatched: "bg-blue-100 text-blue-700",
  resolved: "bg-green-100 text-green-700",
  false_alarm: "bg-slate-100 text-slate-500",
};

async function load(schema: string, status: string, memberId: string | null) {
  return withTenant(schema, async (tx) => {
    const alerts = await tx<AlertRow[]>`
      SELECT a.id, a.member_id, m.full_name AS member, a.kind, a.severity, a.status,
             a.message, z.name AS zone, a.lat, a.lng, a.created_at::text,
             ab.full_name AS acked_by_name, rb.full_name AS resolved_by_name,
             a.resolution_note,
             (SELECT count(*)::int FROM hrc_dispatches d WHERE d.alert_id = a.id) AS dispatches
      FROM hrc_alerts a
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN members ab ON ab.id = a.acked_by
      LEFT JOIN members rb ON rb.id = a.resolved_by
      LEFT JOIN hrc_zones z ON z.id = a.zone_id
      WHERE ${
        status === "open"
          ? tx`a.status IN ('open','ack','dispatched')`
          : status === "all"
            ? tx`true`
            : tx`a.status = ${status}`
      }
        AND ${memberId ? tx`a.member_id = ${memberId}` : tx`true`}
      ORDER BY
        (a.severity = 'critical') DESC,
        (a.status IN ('open','ack')) DESC,
        a.created_at DESC
      LIMIT 200
    `;
    const teams = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM hrc_teams WHERE is_active = true ORDER BY name
    `;
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    return { alerts, teams, members };
  });
}

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { status?: string; member?: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.view");
  const canManage = ctx.member.permissions.has("hrc.alerts.manage");
  const canDispatch = ctx.member.permissions.has("hrc.dispatch");
  const canMonitor = ctx.member.permissions.has("hrc.monitor");

  const status = searchParams.status ?? "open";
  // Someone with only hrc.view sees nothing but their own alerts.
  const memberFilter = canMonitor
    ? (searchParams.member ?? null)
    : ctx.member.memberId;

  const { alerts, teams, members } = await load(
    ctx.company.schema,
    status,
    memberFilter
  );
  const base = `/app/${params.slug}/hrc`;

  return (
    <>
      <PageHeader
        title="هشدارهای HRC"
        description="هشدارهای سلامت، سقوط، SOS، ژئوفنس و قطع ارتباط — رسیدگی و اعزام تیم"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["open", "در جریان"],
          ["all", "همه"],
          ["resolved", ALERT_STATUS.resolved],
          ["false_alarm", ALERT_STATUS.false_alarm],
        ].map(([k, label]) => (
          <Link
            key={k}
            href={`${base}/alerts?status=${k}`}
            className={`badge ${
              status === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {canManage && (
        <div className="mb-6">
          <ManualAlertForm slug={params.slug} members={members} />
        </div>
      )}

      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="card text-sm text-slate-400">هشداری در این نما وجود ندارد.</div>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      {ALERT_KINDS[a.kind as keyof typeof ALERT_KINDS] ?? a.kind}
                    </span>
                    <span className={`badge ${SEVERITY_TONE[a.severity]}`}>
                      {SEVERITY[a.severity as keyof typeof SEVERITY]}
                    </span>
                    <span className={`badge ${statusTone[a.status]}`}>
                      {ALERT_STATUS[a.status as keyof typeof ALERT_STATUS]}
                    </span>
                    {a.dispatches > 0 && (
                      <span className="badge bg-blue-100 text-blue-700">
                        {a.dispatches} اعزام
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{a.message ?? "—"}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {a.member ?? "بدون فرد"} · {a.created_at.slice(0, 16).replace("T", " ")}
                    {a.zone ? ` · ناحیه ${a.zone}` : ""}
                    {a.lat !== null && a.lng !== null
                      ? ` · ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`
                      : ""}
                  </div>
                  {a.resolution_note && (
                    <div className="mt-1 text-xs text-green-700">
                      نتیجه: {a.resolution_note}
                      {a.resolved_by_name ? ` (${a.resolved_by_name})` : ""}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canManage && a.status === "open" && (
                    <form action={setAlertStatusAction}>
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="alertId" value={a.id} />
                      <input type="hidden" name="status" value="ack" />
                      <button className="btn-ghost">در دست بررسی</button>
                    </form>
                  )}
                  {canDispatch &&
                    ["open", "ack"].includes(a.status) &&
                    teams.length > 0 && (
                      <form action={dispatchTeamAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="memberId" value={a.member_id ?? ""} />
                        <select name="teamId" className="input !w-40 !py-1 text-xs">
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <select name="priority" className="input !w-24 !py-1 text-xs" defaultValue="high">
                          <option value="normal">عادی</option>
                          <option value="high">فوری</option>
                          <option value="critical">بحرانی</option>
                        </select>
                        <button className="btn-primary">🚑 اعزام تیم</button>
                      </form>
                    )}
                  {canManage && !["resolved", "false_alarm"].includes(a.status) && (
                    <>
                      <form action={setAlertStatusAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="status" value="resolved" />
                        <input
                          name="note"
                          placeholder="شرح اقدام"
                          className="input !w-36 !py-1 text-xs"
                        />
                        <button className="btn-ghost">رفع شد</button>
                      </form>
                      <form action={setAlertStatusAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="status" value="false_alarm" />
                        <button className="btn-danger">هشدار کاذب</button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
