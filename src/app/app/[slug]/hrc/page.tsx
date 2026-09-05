import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import {
  healthStatus,
  agoLabel,
  POSITION_SOURCES,
  DEVICE_KINDS,
} from "@/lib/hrc";
import { toFaDigits } from "@/lib/jalali";
import { loadPeople, loadThresholds, minutesSince } from "./data";
import { ManualReadingForm } from "./ManualReadingForm";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Vital({
  label,
  value,
  unit,
  bad,
}: {
  label: string;
  value: number | string | null;
  unit: string;
  bad?: boolean;
}) {
  return (
    <div className="min-w-[4.5rem]">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${bad ? "text-red-600" : "text-slate-700"}`} dir="ltr">
        {value === null || value === undefined || value === "" ? "—" : `${value} ${unit}`}
      </div>
    </div>
  );
}

export default async function HrcHome({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.view");
  const canMonitor = ctx.member.permissions.has("hrc.monitor");

  const thresholds = await loadThresholds(ctx.company.schema);
  const people = await loadPeople(
    ctx.company.schema,
    canMonitor ? undefined : ctx.member.memberId
  );
  const base = `/app/${params.slug}/hrc`;

  const statuses = people.map((p) => {
    const mins = minutesSince(p.recorded_at);
    return {
      p,
      mins,
      status: healthStatus(
        p.recorded_at
          ? {
              heart_rate: p.heart_rate,
              spo2: p.spo2,
              body_temp: p.body_temp === null ? null : Number(p.body_temp),
              battery: p.battery,
              motion: p.motion,
            }
          : null,
        thresholds,
        mins
      ),
    };
  });

  const critical = statuses.filter((s) => s.status.level === "critical").length;
  const warn = statuses.filter((s) => s.status.level === "warn").length;
  const offline = statuses.filter((s) => s.status.level === "offline").length;
  const wearing = people.filter((p) => p.serial).length;

  return (
    <>
      <PageHeader
        title="HRC — پایش سلامت و موقعیت"
        description={
          canMonitor
            ? "وضعیت زندهٔ علائم حیاتی و موقعیت نفرات؛ هشدارها به‌صورت خودکار از روی آستانه‌های شرکت ساخته می‌شوند"
            : "وضعیت سلامت و موقعیت ثبت‌شدهٔ خودتان"
        }
        action={
          <Link href={`${base}/map`} className="btn-primary">
            🗺 نقشهٔ زندهٔ شرکت
          </Link>
        }
      />

      {canMonitor && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="وضعیت بحرانی" value={toFaDigits(critical)} hint="نیازمند اعزام تیم" />
          <Kpi label="نیازمند توجه" value={toFaDigits(warn)} />
          <Kpi label="بدون ارتباط" value={toFaDigits(offline)} hint={`بیش از ${thresholds.offline_minutes} دقیقه`} />
          <Kpi label="دستگاه فعال" value={toFaDigits(wearing)} hint="ساعت/مچ‌بند تخصیص‌یافته" />
        </div>
      )}

      <div className="space-y-3">
        {statuses.length === 0 ? (
          <div className="card text-sm text-slate-400">داده‌ای برای نمایش نیست.</div>
        ) : (
          statuses.map(({ p, mins, status }) => (
            <div key={p.member_id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[10rem]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{p.full_name}</span>
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                    {p.open_alerts > 0 && (
                      <Link
                        href={`${base}/alerts?member=${p.member_id}`}
                        className="badge bg-red-100 text-red-700"
                      >
                        {toFaDigits(p.open_alerts)} هشدار باز
                      </Link>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {p.title ?? "—"}
                    {p.serial ? ` · دستگاه ${p.serial}` : " · بدون دستگاه"}
                    {` · ${agoLabel(mins)}`}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Vital
                    label="ضربان"
                    value={p.heart_rate}
                    unit="bpm"
                    bad={
                      p.heart_rate !== null &&
                      (p.heart_rate > thresholds.hr_max || p.heart_rate < thresholds.hr_min)
                    }
                  />
                  <Vital
                    label="اکسیژن"
                    value={p.spo2}
                    unit="%"
                    bad={p.spo2 !== null && p.spo2 < thresholds.spo2_min}
                  />
                  <Vital
                    label="دما"
                    value={p.body_temp}
                    unit="°C"
                    bad={
                      p.body_temp !== null &&
                      Number(p.body_temp) > Number(thresholds.temp_max)
                    }
                  />
                  <Vital label="قدم" value={p.steps} unit="" />
                  <Vital
                    label="باتری"
                    value={p.battery}
                    unit="%"
                    bad={p.battery !== null && p.battery <= thresholds.battery_low}
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                {p.zone_name ? (
                  <span
                    className="badge"
                    style={{
                      backgroundColor: `${p.zone_color}22`,
                      color: p.zone_color ?? undefined,
                    }}
                  >
                    📍 {p.zone_name}
                  </span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-500">خارج از ناحیه‌های تعریف‌شده</span>
                )}
                {p.lat !== null && p.lng !== null && (
                  <span dir="ltr">
                    {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                  </span>
                )}
                {p.source && (
                  <span>
                    منبع موقعیت: {POSITION_SOURCES[p.source as keyof typeof POSITION_SOURCES] ?? p.source}
                  </span>
                )}
                {p.motion && <span>حرکت: {p.motion}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {canMonitor && (
        <div className="mt-6">
          <ManualReadingForm
            slug={params.slug}
            members={people.map((p) => ({ id: p.member_id, full_name: p.full_name }))}
          />
          <p className="mt-2 text-[11px] text-slate-400">
            دستگاه‌های پشتیبانی‌شده: {Object.values(DEVICE_KINDS).join(" · ")} — داده‌ها از
            طریق <span dir="ltr">POST /api/{params.slug}/hrc/ingest</span> ارسال می‌شوند.
          </p>
        </div>
      )}
    </>
  );
}
