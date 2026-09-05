import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { FiscalYearForm } from "./FiscalYearForm";
import { setFiscalYearStateAction } from "../actions";

async function load(schema: string) {
  return withTenant(schema, async (tx) =>
    tx<
      {
        id: string;
        title: string;
        start_date: string;
        end_date: string;
        is_active: boolean;
        is_closed: boolean;
        entries: number;
      }[]
    >`
      SELECT f.id, f.title, f.start_date::text, f.end_date::text,
             f.is_active, f.is_closed,
             (SELECT count(*)::int FROM ledger_entries e
              WHERE e.fiscal_year_id = f.id) AS entries
      FROM fiscal_years f ORDER BY f.start_date DESC
    `
  );
}

export default async function PeriodsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "finance");
  ensurePermission(ctx, "finance.periods.manage");
  const years = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="سال مالی و دوره‌ها"
        description="سال مالی فعال، اسناد هر دوره و بستن/بازکردن دوره"
      />

      <div className="mb-6">
        <FiscalYearForm slug={params.slug} />
      </div>

      <div className="space-y-3">
        {years.length === 0 ? (
          <div className="card text-sm text-slate-400">سال مالی تعریف نشده است.</div>
        ) : (
          years.map((y) => (
            <div key={y.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{y.title}</span>
                  {y.is_active && (
                    <span className="badge bg-green-100 text-green-700">فعال</span>
                  )}
                  {y.is_closed && (
                    <span className="badge bg-slate-100 text-slate-500">بسته</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400" dir="ltr">
                  {y.start_date} → {y.end_date} · {y.entries} سند
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!y.is_active && (
                  <form action={setFiscalYearStateAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={y.id} />
                    <input type="hidden" name="op" value="activate" />
                    <button className="btn-ghost">فعال کن</button>
                  </form>
                )}
                <form action={setFiscalYearStateAction}>
                  <input type="hidden" name="slug" value={params.slug} />
                  <input type="hidden" name="id" value={y.id} />
                  <input type="hidden" name="op" value={y.is_closed ? "reopen" : "close"} />
                  <button className={y.is_closed ? "btn-ghost" : "btn-danger"}>
                    {y.is_closed ? "بازکردن دوره" : "بستن دوره"}
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
