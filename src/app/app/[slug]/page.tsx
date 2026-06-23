import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import {
  todayJalali,
  isoDate,
  toFaDigits,
  JALALI_MONTHS,
} from "@/lib/jalali";
import { loadMonthSheet } from "./attendance/data";
import { loadBalance } from "@/lib/leave-balance";
import { formatDuration, formatTime } from "@/lib/attendance";

/* --------------------------------- UI bits -------------------------------- */

function Kpi({
  label,
  value,
  unit,
  tone = "text-slate-800",
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${tone}`} dir="ltr">
          {value}
        </span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function PanelRow({
  label,
  value,
  unit,
  tone = "text-slate-700",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`text-sm font-semibold ${tone}`}>{value}</span>
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </span>
    </div>
  );
}

function Panel({
  title,
  icon,
  href,
  children,
}: {
  title: string;
  icon: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        </div>
        {href && (
          <Link href={href} className="text-xs text-brand-600 hover:underline">
            مشاهده
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------- the page -------------------------------- */

export default async function TenantDashboard({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const base = `/app/${params.slug}`;
  const today = todayJalali();
  const todayIso = isoDate(new Date());

  const [sheet, balance, extra] = await Promise.all([
    loadMonthSheet(ctx.company.schema, ctx.member.memberId, today.jy, today.jm),
    loadBalance(ctx.company.schema, ctx.member.memberId, today.jy),
    withTenant(ctx.company.schema, async (tx) => {
      const leave = await tx<{ status: string; c: number }[]>`
        SELECT status, count(*)::int AS c FROM leave_requests
        WHERE member_id = ${ctx.member.memberId} GROUP BY status
      `;
      const [kt] = await tx<{ tasks: number; approvals: number }[]>`
        SELECT
          (SELECT count(*) FROM kartabl_items i JOIN kartabls k ON k.id=i.kartabl_id
             WHERE k.member_id=${ctx.member.memberId} AND i.kind<>'approval'
               AND i.status IN ('open','in_progress'))::int AS tasks,
          (SELECT count(*) FROM kartabl_items i JOIN kartabls k ON k.id=i.kartabl_id
             WHERE k.member_id=${ctx.member.memberId} AND i.kind='approval')::int AS approvals
      `;
      return { leave, kt };
    }),
  ]);

  const leaveBy = (s: string) =>
    extra.leave.find((l) => l.status === s)?.c ?? 0;

  const todayRow = sheet.days.find((d) => d.iso === todayIso);
  const lastPunch = todayRow?.punches[todayRow.punches.length - 1];
  const incompletePunch = sheet.days.filter(
    (d) => d.punches.length % 2 === 1
  ).length;
  const deficitDays = sheet.days.filter((d) => d.deficitMinutes > 0).length;

  const monthName = `${JALALI_MONTHS[today.jm - 1]} ${toFaDigits(today.jy)}`;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">
          سلام، {ctx.member.fullName}
        </h1>
        <p className="mt-0.5 text-sm text-slate-400">
          داشبورد {ctx.company.name} — {monthName}
        </p>
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="آخرین تردد امروز"
          value={lastPunch ? formatTime(lastPunch.at) : "—"}
          hint={lastPunch ? (lastPunch.kind === "in" ? "ورود" : "خروج") : "ثبت‌نشده"}
          tone={lastPunch?.kind === "in" ? "text-green-700" : "text-slate-700"}
        />
        <Kpi
          label="کارکرد این ماه"
          value={formatDuration(sheet.totals.workedMinutes)}
          unit="ساعت"
          tone="text-brand-700"
        />
        <Kpi
          label="مانده مرخصی استحقاقی"
          value={toFaDigits(balance.remaining)}
          unit="روز"
          tone={balance.remaining < 0 ? "text-red-700" : "text-green-700"}
        />
        <Kpi
          label="درخواست‌های در جریان"
          value={toFaDigits(leaveBy("pending"))}
          unit="مورد"
          tone="text-amber-700"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* کارکرد من */}
        <Panel title="کارکرد من" icon="📊" href={`${base}/attendance`}>
          <PanelRow label="کل حضور (کارکرد)" value={formatDuration(sheet.totals.workedMinutes)} unit="ساعت" tone="text-brand-700" />
          <PanelRow label="روزهای حاضر" value={toFaDigits(sheet.totals.presentDays)} unit="روز" tone="text-green-700" />
          <PanelRow label="مجموع تأخیر" value={formatDuration(sheet.totals.lateMinutes)} unit="ساعت" tone="text-amber-700" />
          <PanelRow label="اضافه‌کار" value={formatDuration(sheet.totals.overtimeMinutes)} unit="ساعت" tone="text-indigo-700" />
          <PanelRow label="کسر کار" value={formatDuration(sheet.totals.deficitMinutes)} unit="ساعت" tone="text-rose-700" />
        </Panel>

        {/* وضعیت مرخصی‌ها */}
        <Panel title="وضعیت مرخصی‌ها" icon="🏖️" href={`${base}/leave`}>
          <PanelRow label="در جریان (منتظر تأیید)" value={toFaDigits(leaveBy("pending"))} unit="مورد" tone="text-amber-700" />
          <PanelRow label="تأییدشده" value={toFaDigits(leaveBy("approved"))} unit="مورد" tone="text-green-700" />
          <PanelRow label="ردشده" value={toFaDigits(leaveBy("rejected"))} unit="مورد" tone="text-red-700" />
          <PanelRow label="استحقاق امسال" value={toFaDigits(balance.accrued)} unit="روز" />
          <PanelRow label="ذخیره سال قبل" value={toFaDigits(balance.carriedIn)} unit="روز" />
        </Panel>

        {/* نیازمند توجه / کارتابل */}
        <Panel title="نیازمند توجه" icon="🔔">
          <PanelRow label="درخواست‌های منتظر تأیید شما" value={toFaDigits(extra.kt.approvals)} unit="مورد" tone={extra.kt.approvals > 0 ? "text-amber-700" : "text-slate-400"} />
          <PanelRow label="کارهای باز کارتابل" value={toFaDigits(extra.kt.tasks)} unit="مورد" tone="text-blue-700" />
          <PanelRow label="تردد ناقص این ماه" value={toFaDigits(incompletePunch)} unit="روز" tone={incompletePunch > 0 ? "text-red-700" : "text-slate-400"} />
          <PanelRow label="روزهای دارای کسرکار" value={toFaDigits(deficitDays)} unit="روز" tone={deficitDays > 0 ? "text-rose-700" : "text-slate-400"} />
          <div className="pt-2">
            <Link href={`${base}/kartabl`} className="text-xs text-brand-600 hover:underline">
              رفتن به کارتابل من ←
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
