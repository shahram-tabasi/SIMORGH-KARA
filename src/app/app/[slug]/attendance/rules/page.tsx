import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { savePolicyAction } from "../actions";

interface Policy {
  grace_minutes: number;
  standard_daily_minutes: number;
  monthly_leave_days: string;
  annual_leave_days: string;
  overtime_enabled: boolean;
  max_punches_per_week: number;
  max_punches_per_month: number;
}

export default async function RulesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const [policy] = await withTenant(ctx.company.schema, async (tx) =>
    tx<Policy[]>`
      SELECT grace_minutes, standard_daily_minutes, monthly_leave_days,
             annual_leave_days, overtime_enabled,
             max_punches_per_week, max_punches_per_month
      FROM attendance_policy WHERE id = 1
    `
  );

  const p = policy ?? {
    grace_minutes: 0,
    standard_daily_minutes: 480,
    monthly_leave_days: "2.5",
    annual_leave_days: "26",
    overtime_enabled: true,
    max_punches_per_week: 0,
    max_punches_per_month: 0,
  };

  return (
    <>
      <PageHeader
        title="قوانین حضور"
        description="تعیین قوانین تأخیر مجاز، کارکرد استاندارد، سقف مرخصی و اضافه‌کاری"
      />

      <form action={savePolicyAction} className="card max-w-2xl space-y-5">
        <input type="hidden" name="slug" value={params.slug} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">تأخیر مجاز (دقیقه)</label>
            <input
              name="grace_minutes"
              type="number"
              min={0}
              max={240}
              defaultValue={p.grace_minutes}
              className="input"
              dir="ltr"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              تا این میزان دیرکرد، «تأخیر» محسوب نمی‌شود.
            </p>
          </div>
          <div>
            <label className="label">کارکرد استاندارد روزانه (دقیقه)</label>
            <input
              name="standard_daily_minutes"
              type="number"
              min={60}
              max={1440}
              defaultValue={p.standard_daily_minutes}
              className="input"
              dir="ltr"
            />
            <p className="mt-1 text-[11px] text-slate-400">۴۸۰ دقیقه = ۸ ساعت</p>
          </div>
          <div>
            <label className="label">سقف مرخصی ماهانه (روز)</label>
            <input
              name="monthly_leave_days"
              type="number"
              step="0.5"
              min={0}
              defaultValue={p.monthly_leave_days}
              className="input"
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">سقف مرخصی سالانه (روز)</label>
            <input
              name="annual_leave_days"
              type="number"
              step="0.5"
              min={0}
              defaultValue={p.annual_leave_days}
              className="input"
              dir="ltr"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="overtime_enabled"
            defaultChecked={p.overtime_enabled}
          />
          محاسبه اضافه‌کاری فعال باشد
        </label>

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-700">
            سقف ثبت تردد دستی (کارگزینی)
          </div>
          <p className="mb-3 text-[11px] text-slate-400">
            بیشینهٔ تعداد ثبت تردد دستی هر کارمند در هفته/ماه. مقدار ۰ یعنی
            بدون محدودیت. (ترددهای دستگاه شمرده نمی‌شوند.)
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">حداکثر در هفته</label>
              <input
                type="number"
                name="max_punches_per_week"
                min={0}
                defaultValue={p.max_punches_per_week}
                className="input"
                dir="ltr"
              />
            </div>
            <div>
              <label className="label">حداکثر در ماه</label>
              <input
                type="number"
                name="max_punches_per_month"
                min={0}
                defaultValue={p.max_punches_per_month}
                className="input"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary">ذخیره قوانین</button>
        </div>
      </form>
    </>
  );
}
