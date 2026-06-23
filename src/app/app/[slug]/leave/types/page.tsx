import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { LeaveTypeCard } from "./LeaveTypeCard";
import { LeaveTypeForm, type LeaveTypeData } from "./LeaveTypeForm";

interface Row extends LeaveTypeData {
  is_system: boolean;
}

export default async function LeaveTypesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "leave.types.manage");

  const types = await withTenant(ctx.company.schema, async (tx) =>
    tx<Row[]>`
      SELECT id, name, unit, paid, deducts_entitlement, counts_inner_holidays,
             requires_attachment, max_minutes_per_day, max_count_per_month,
             max_count_per_week, max_days_per_year, approval_levels, is_active,
             is_system, sort_order, description
      FROM leave_types ORDER BY sort_order, name
    `
  );

  return (
    <>
      <PageHeader
        title="انواع مرخصی"
        description="تعریف و ویرایش انواع مرخصی و قوانین هر کدام؛ مطابق دستورالعمل و قانون کار شرکت"
      />

      <div className="space-y-4">
        {types.map((t) => (
          <LeaveTypeCard
            key={t.id}
            slug={params.slug}
            type={t}
            isSystem={t.is_system}
          />
        ))}
      </div>

      <div className="card mt-6 border-dashed">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          افزودن نوع مرخصی جدید
        </h3>
        <LeaveTypeForm slug={params.slug} />
      </div>
    </>
  );
}
