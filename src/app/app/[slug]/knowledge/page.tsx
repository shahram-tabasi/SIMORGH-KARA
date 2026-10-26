import { requireTenant } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { SyncStatus } from "@/components/SyncStatus";
import { syncViews } from "@/lib/sync";
import { KINDS, featuresText, managedUnits, UNIT_PATHS_SQL, type KnowledgeKind, type UnitOption } from "@/lib/knowledge";
import type { CompanyApps } from "@/lib/apps";
import { KnowledgeForm } from "./KnowledgeForm";
import { deleteKnowledgeAction, setKnowledgeActiveAction } from "./actions";

interface Row {
  id: string;
  kind: KnowledgeKind;
  name: string;
  code: string | null;
  summary: string | null;
  body: string | null;
  attributes: Record<string, unknown>;
  address: string | null;
  impact: string | null;
  effective_date: string | null;
  sequence: number;
  active: boolean;
  updated_at: Date;
  file_name: string | null;
  file_size: number | null;
  unit_id: string | null;
}

/**
 * Company knowledge: what Design Suite and the HR chatbot should know about
 * this company. Kept here (Kara is the master) and copied to Odoo.
 */
export default async function KnowledgePage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  const canManage = ctx.member.permissions.has("knowledge.manage");
  const allUnits = await withTenant(ctx.company.schema, (tx) => tx.unsafe<(UnitOption & { manager: string | null })[]>(UNIT_PATHS_SQL));
  const units: UnitOption[] = allUnits.map(({ id, path }) => ({ id, path }));
  const pathOf = new Map(units.map((u) => [u.id, u.path]));
  // A unit's manager keeps the orders and rules of their units here.
  const mine = canManage ? [] : managedUnits(allUnits, ctx.member.memberId);
  const canView = ctx.member.permissions.has("knowledge.view") || canManage || mine.length > 0;
  if (!canView) throw new Error("شما مجوز مشاهدهٔ این بخش را ندارید.");
  const canAdd = canManage || mine.length > 0;
  const canEdit = (r: Row) => canManage || (!!r.unit_id && mine.some((u) => u.id === r.unit_id));

  const rows = await withTenant(ctx.company.schema, (tx) => tx<Row[]>`
    SELECT id, kind, name, code, summary, body, attributes, address, impact,
           to_char(effective_date, 'YYYY-MM-DD') AS effective_date, sequence, active, updated_at, file_name, file_size, unit_id::text
    FROM knowledge ORDER BY active DESC, sequence, name`);
  const [company] = await sql<{ apps: CompanyApps }[]>`SELECT apps FROM platform.companies WHERE id = ${ctx.company.id}`;
  const sync = company?.apps?.erp ? (await syncViews("company", [ctx.company.id]))[ctx.company.id] : undefined;

  return (
    <>
      <PageHeader
        title="دانش شرکت"
        description="محصولات و ویژگی‌هایشان، منابع داده، بخشنامه‌ها و آیین‌نامه‌ها (متن یا سند PDF/Word) — Design Suite، و دستیار هوش مصنوعی (منابع انسانی) با همین‌ها به افراد این شرکت پاسخ می‌دهند"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {company?.apps?.erp ? <>نسخهٔ Odoo: <SyncStatus view={sync} /></> : <>فقط در کارا نگه داشته می‌شود (Odoo برای این شرکت روشن نیست).</>}
      </div>

      {canAdd && (
        <details className="card mb-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            {canManage ? "＋ افزودن" : "＋ افزودن قانون یا دستور ویژهٔ واحد شما"}
          </summary>
          <div className="mt-4"><KnowledgeForm slug={params.slug} units={canManage ? units : mine} unitOnly={!canManage} /></div>
        </details>
      )}

      <div className="space-y-6">
        {KINDS.map((k) => {
          const items = rows.filter((r) => r.kind === k.key);
          return (
            <section key={k.key} className="card">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  {k.label} <span className="badge bg-slate-100 text-slate-600">{items.length}</span>
                </h2>
                <span className="text-xs text-slate-500">{k.note} — برای {k.apps}</span>
              </div>
              {items.length === 0 ? (
                <div className="text-sm text-slate-500">چیزی ثبت نشده است.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((r) => (
                    <li key={r.id} className={`py-3 ${r.active ? "" : "opacity-60"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800">
                            {r.code && <span className="ml-2 font-mono text-xs text-slate-500" dir="ltr">{r.code}</span>}
                            {r.name}
                            {!r.active && <span className="badge mr-2 bg-slate-100 text-slate-600">بایگانی</span>}
                            {r.unit_id && <span className="badge mr-2 bg-brand-50 text-brand-700">فقط واحد: {pathOf.get(r.unit_id) ?? "—"}</span>}
                          </div>
                          {r.summary && <div className="text-sm text-slate-600">{r.summary}</div>}
                          {r.file_name && (
                            <a href={`/app/${params.slug}/knowledge/file/${r.id}`} className="text-xs text-brand-700 underline">
                              📄 {r.file_name} ({Math.max(1, Math.round((r.file_size ?? 0) / 1024))} KB)
                            </a>
                          )}
                          {r.body && <div className="text-xs text-slate-500">{r.body.length.toLocaleString("fa-IR")} نویسه متن برای دستیارها</div>}
                          {r.address && <div className="font-mono text-xs text-slate-600" dir="ltr">{r.address}</div>}
                          {r.effective_date && <div className="text-xs text-slate-500">از {new Date(r.effective_date).toLocaleDateString("fa-IR")}</div>}
                          {r.impact && <div className="text-xs text-amber-800">اثر: {r.impact}</div>}
                          {Object.keys(r.attributes ?? {}).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1" dir="ltr">
                              {Object.entries(r.attributes).map(([key, val]) => (
                                <span key={key} className="badge bg-slate-100 text-slate-600">{key}: {String(val)}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {canEdit(r) && (
                          <div className="flex gap-2">
                            <form action={setKnowledgeActiveAction}>
                              <input type="hidden" name="slug" value={params.slug} />
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="active" value={String(!r.active)} />
                              <button className="btn-ghost text-xs">{r.active ? "بایگانی" : "بازگرداندن"}</button>
                            </form>
                            <form action={deleteKnowledgeAction}>
                              <input type="hidden" name="slug" value={params.slug} />
                              <input type="hidden" name="id" value={r.id} />
                              <button className="btn-ghost text-xs text-red-700" title="از کارا حذف می‌شود و نسخهٔ Odoo بایگانی می‌شود">حذف</button>
                            </form>
                          </div>
                        )}
                      </div>
                      {canEdit(r) && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-slate-500">ویرایش</summary>
                          <div className="mt-3">
                            <KnowledgeForm
                              slug={params.slug}
                              units={canManage ? units : mine}
                              unitOnly={!canManage}
                              initial={{
                                id: r.id, kind: r.kind, name: r.name, code: r.code ?? "", summary: r.summary ?? "", body: r.body ?? "",
                                features: featuresText(r.attributes), address: r.address ?? "", impact: r.impact ?? "",
                                effectiveDate: r.effective_date ?? "", sequence: r.sequence, fileName: r.file_name,
                                unitId: r.unit_id ?? "",
                              }}
                            />
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
