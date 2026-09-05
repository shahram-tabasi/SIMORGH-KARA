import Link from "next/link";
import { requireTenant, hasModule } from "@/lib/session";
import { MODULES, type ModuleKey } from "@/lib/modules";
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
  searchParams,
}: {
  params: { slug: string };
  searchParams: { denied?: string };
}) {
  const ctx = await requireTenant(params.slug);
  const base = `/app/${params.slug}`;
  const today = todayJalali();
  const todayIso = isoDate(new Date());

  // Each panel contributes to the dashboard only when the company has it.
  const hr = hasModule(ctx, "hr");
  const finance = hasModule(ctx, "finance");
  const inventory = hasModule(ctx, "inventory");
  const hrc = hasModule(ctx, "hrc");
  const can = (k: string) => ctx.member.permissions.has(k);

  const [sheet, balance, extra] = await Promise.all([
    hr
      ? loadMonthSheet(ctx.company.schema, ctx.member.memberId, today.jy, today.jm)
      : Promise.resolve(null),
    hr
      ? loadBalance(ctx.company.schema, ctx.member.memberId, today.jy)
      : Promise.resolve(null),
    withTenant(ctx.company.schema, async (tx) => {
      const leave = hr
        ? await tx<{ status: string; c: number }[]>`
            SELECT status, count(*)::int AS c FROM leave_requests
            WHERE member_id = ${ctx.member.memberId} GROUP BY status
          `
        : [];
      const [kt] = await tx<{ tasks: number; approvals: number }[]>`
        SELECT
          (SELECT count(*) FROM kartabl_items i JOIN kartabls k ON k.id=i.kartabl_id
             WHERE k.member_id=${ctx.member.memberId} AND i.kind<>'approval'
               AND i.status IN ('open','in_progress'))::int AS tasks,
          (SELECT count(*) FROM kartabl_items i JOIN kartabls k ON k.id=i.kartabl_id
             WHERE k.member_id=${ctx.member.memberId} AND i.kind='approval')::int AS approvals
      `;
      const [fin] = finance && can("ledger.view")
        ? await tx<{ drafts: number; posted: number }[]>`
            SELECT (SELECT count(*)::int FROM ledger_entries WHERE status='draft')  AS drafts,
                   (SELECT count(*)::int FROM ledger_entries WHERE status='posted') AS posted
          `
        : [{ drafts: 0, posted: 0 }];
      const [inv] = inventory && can("inventory.view")
        ? await tx<{ drafts: number; requests: number; low: number }[]>`
            SELECT (SELECT count(*)::int FROM stock_docs WHERE status='draft') AS drafts,
                   (SELECT count(*)::int FROM stock_requests WHERE status='pending') AS requests,
                   (SELECT count(*)::int FROM stock_levels s JOIN items i ON i.id=s.item_id
                      WHERE s.qty <= i.min_stock) AS low
          `
        : [{ drafts: 0, requests: 0, low: 0 }];
      const [safety] = hrc && can("hrc.view")
        ? await tx<{ alerts: number; dispatches: number }[]>`
            SELECT (SELECT count(*)::int FROM hrc_alerts
                      WHERE status IN ('open','ack','dispatched')) AS alerts,
                   (SELECT count(*)::int FROM hrc_dispatches
                      WHERE status IN ('dispatched','enroute','onsite')) AS dispatches
          `
        : [{ alerts: 0, dispatches: 0 }];
      return { leave, kt, fin, inv, safety };
    }),
  ]);

  const leaveBy = (s: string) =>
    extra.leave.find((l) => l.status === s)?.c ?? 0;

  const todayRow = sheet?.days.find((d) => d.iso === todayIso);
  const lastPunch = todayRow?.punches[todayRow.punches.length - 1];
  const incompletePunch =
    sheet?.days.filter((d) => d.punches.length % 2 === 1).length ?? 0;
  const deficitDays = sheet?.days.filter((d) => d.deficitMinutes > 0).length ?? 0;

  const monthName = `${JALALI_MONTHS[today.jm - 1]} ${toFaDigits(today.jy)}`;

  return (
    <>
      {searchParams.denied && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          🔒 پنل «{MODULES[searchParams.denied as ModuleKey]?.name ?? searchParams.denied}»
          {" "}برای شما در دسترس نیست — یا برای این شرکت فعال نشده است، یا مجوز آن به
          شما داده نشده. برای دسترسی با مدیر شرکت هماهنگ کنید.
        </div>
      )}

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">
          سلام، {ctx.member.fullName}
        </h1>
        <p className="mt-0.5 text-sm text-slate-400">
          داشبورد {ctx.company.name} — {monthName}
        </p>
      </div>

      {/* KPI strip — منابع انسانی (فقط وقتی پنل حضور و غیاب فعال است) */}
      {hr && sheet && balance && (
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
      )}

      {/* KPI strip — پنل‌های مالی، انبار و HRC */}
      {(finance || inventory || hrc) && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {finance && can("ledger.view") && (
            <Kpi
              label="اسناد مالی پیش‌نویس"
              value={toFaDigits(extra.fin.drafts)}
              unit="سند"
              tone={extra.fin.drafts > 0 ? "text-amber-700" : "text-slate-700"}
              hint={`${toFaDigits(extra.fin.posted)} سند قطعی`}
            />
          )}
          {inventory && can("inventory.view") && (
            <Kpi
              label="اسناد انبار در انتظار تأیید"
              value={toFaDigits(extra.inv.drafts)}
              unit="سند"
              tone={extra.inv.drafts > 0 ? "text-amber-700" : "text-slate-700"}
              hint={`${toFaDigits(extra.inv.requests)} درخواست کالا`}
            />
          )}
          {inventory && can("inventory.view") && (
            <Kpi
              label="کالای زیر نقطهٔ سفارش"
              value={toFaDigits(extra.inv.low)}
              unit="قلم"
              tone={extra.inv.low > 0 ? "text-rose-700" : "text-green-700"}
            />
          )}
          {hrc && can("hrc.view") && (
            <Kpi
              label="هشدارهای باز HRC"
              value={toFaDigits(extra.safety.alerts)}
              unit="مورد"
              tone={extra.safety.alerts > 0 ? "text-red-700" : "text-green-700"}
              hint={`${toFaDigits(extra.safety.dispatches)} اعزام در جریان`}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* کارکرد من */}
        {hr && sheet && balance && (
        <Panel title="کارکرد من" icon="📊" href={`${base}/attendance`}>
          <PanelRow label="کل حضور (کارکرد)" value={formatDuration(sheet.totals.workedMinutes)} unit="ساعت" tone="text-brand-700" />
          <PanelRow label="روزهای حاضر" value={toFaDigits(sheet.totals.presentDays)} unit="روز" tone="text-green-700" />
          <PanelRow label="مجموع تأخیر" value={formatDuration(sheet.totals.lateMinutes)} unit="ساعت" tone="text-amber-700" />
          <PanelRow label="اضافه‌کار" value={formatDuration(sheet.totals.overtimeMinutes)} unit="ساعت" tone="text-indigo-700" />
          <PanelRow label="کسر کار" value={formatDuration(sheet.totals.deficitMinutes)} unit="ساعت" tone="text-rose-700" />
        </Panel>
        )}

        {/* وضعیت مرخصی‌ها */}
        {hr && balance && (
        <Panel title="وضعیت مرخصی‌ها" icon="🏖️" href={`${base}/leave`}>
          <PanelRow label="در جریان (منتظر تأیید)" value={toFaDigits(leaveBy("pending"))} unit="مورد" tone="text-amber-700" />
          <PanelRow label="تأییدشده" value={toFaDigits(leaveBy("approved"))} unit="مورد" tone="text-green-700" />
          <PanelRow label="ردشده" value={toFaDigits(leaveBy("rejected"))} unit="مورد" tone="text-red-700" />
          <PanelRow label="استحقاق امسال" value={toFaDigits(balance.accrued)} unit="روز" />
          <PanelRow label="ذخیره سال قبل" value={toFaDigits(balance.carriedIn)} unit="روز" />
        </Panel>
        )}

        {/* پنل مالی */}
        {finance && can("ledger.view") && (
          <Panel title="مالی — سیمرغ لجر" icon="📒" href={`${base}/finance`}>
            <PanelRow label="اسناد قطعی" value={toFaDigits(extra.fin.posted)} unit="سند" tone="text-green-700" />
            <PanelRow label="اسناد پیش‌نویس" value={toFaDigits(extra.fin.drafts)} unit="سند" tone="text-amber-700" />
            <div className="pt-2">
              <Link href={`${base}/finance/reports`} className="text-xs text-brand-600 hover:underline">
                تراز آزمایشی و دفتر معین ←
              </Link>
            </div>
          </Panel>
        )}

        {/* پنل انبار */}
        {inventory && can("inventory.view") && (
          <Panel title="انبار" icon="📦" href={`${base}/inventory`}>
            <PanelRow label="اسناد در انتظار تأیید" value={toFaDigits(extra.inv.drafts)} unit="سند" tone={extra.inv.drafts > 0 ? "text-amber-700" : "text-slate-400"} />
            <PanelRow label="درخواست کالای باز" value={toFaDigits(extra.inv.requests)} unit="مورد" tone="text-blue-700" />
            <PanelRow label="کالای زیر نقطهٔ سفارش" value={toFaDigits(extra.inv.low)} unit="قلم" tone={extra.inv.low > 0 ? "text-rose-700" : "text-green-700"} />
            <div className="pt-2">
              <Link href={`${base}/inventory/docs/new`} className="text-xs text-brand-600 hover:underline">
                ثبت سند انبار ←
              </Link>
            </div>
          </Panel>
        )}

        {/* پنل HRC */}
        {hrc && can("hrc.view") && (
          <Panel title="HRC — سلامت و ایمنی" icon="❤️" href={`${base}/hrc`}>
            <PanelRow label="هشدارهای باز" value={toFaDigits(extra.safety.alerts)} unit="مورد" tone={extra.safety.alerts > 0 ? "text-red-700" : "text-green-700"} />
            <PanelRow label="اعزام‌های در جریان" value={toFaDigits(extra.safety.dispatches)} unit="مورد" tone="text-blue-700" />
            <div className="pt-2">
              <Link href={`${base}/hrc/map`} className="text-xs text-brand-600 hover:underline">
                نقشهٔ زندهٔ شرکت ←
              </Link>
            </div>
          </Panel>
        )}

        {/* نیازمند توجه / کارتابل */}
        <Panel title="نیازمند توجه" icon="🔔">
          <PanelRow label="درخواست‌های منتظر تأیید شما" value={toFaDigits(extra.kt.approvals)} unit="مورد" tone={extra.kt.approvals > 0 ? "text-amber-700" : "text-slate-400"} />
          <PanelRow label="کارهای باز کارتابل" value={toFaDigits(extra.kt.tasks)} unit="مورد" tone="text-blue-700" />
          {hr && (
            <>
              <PanelRow label="تردد ناقص این ماه" value={toFaDigits(incompletePunch)} unit="روز" tone={incompletePunch > 0 ? "text-red-700" : "text-slate-400"} />
              <PanelRow label="روزهای دارای کسرکار" value={toFaDigits(deficitDays)} unit="روز" tone={deficitDays > 0 ? "text-rose-700" : "text-slate-400"} />
            </>
          )}
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
