import Link from "next/link";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { linkOdooCompanyAction, resyncCompanyAction, setCompanyAppsAction, setCompanyStatusAction, updateCompanyAction } from "../actions";
import { APPS, type CompanyApps } from "@/lib/apps";
import { syncViews } from "@/lib/sync";
import { SyncStatus } from "@/components/SyncStatus";
import { karaApi, karaApiEnabled } from "@/lib/kara-api";
import { requirePlatformAdmin } from "@/lib/session";

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  max_users: number;
  odoo_company_id: number | null;
  apps: CompanyApps;
  user_count: number;
  created_at: string;
}

async function getCompanies(): Promise<CompanyRow[]> {
  return sql<CompanyRow[]>`
    SELECT c.id, c.name, c.slug, c.status, c.plan, c.max_users, c.odoo_company_id, c.apps,
           c.created_at,
           (SELECT count(*) FROM platform.user_accounts u
              WHERE u.company_id = c.id)::int AS user_count
    FROM platform.companies c
    ORDER BY c.created_at DESC
  `;
}

const statusBadge: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

const statusLabel: Record<string, string> = {
  active: "فعال",
  suspended: "معلق",
  pending: "در انتظار",
};

type OdooCompanies = { items: { id: number; name: string }[] } | { error: string } | null;

/** Odoo's companies, for linking tenants; null when Kara runs without kara-api. */
async function getOdooCompanies(accountId: string): Promise<OdooCompanies> {
  if (!karaApiEnabled()) return null;
  try {
    return await karaApi<{ items: { id: number; name: string }[] }>(accountId, "GET", "/v1/admin/erp/companies");
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: { erp_slug?: string; erp_error?: string } }) {
  const { session } = await requirePlatformAdmin();
  const [companies, odoo] = await Promise.all([getCompanies(), getOdooCompanies(session.sub)]);
  const sync = await syncViews("company", companies.map((c) => c.id));
  const odooCompanies = odoo && "items" in odoo ? odoo.items : null;

  return (
    <>
      <PageHeader
        title="شرکت‌ها"
        description="مدیریت سطح دسترسی، پلن و وضعیت هر شرکت"
        action={
          <Link href="/admin/companies/new" className="btn-primary">
            ＋ افزودن شرکت
          </Link>
        }
      />

      {odoo && "error" in odoo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          اتصال به Odoo برقرار نشد، پس فهرست شرکت‌های Odoo در دسترس نیست: {odoo.error}
        </div>
      )}

      {companies.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          هنوز شرکتی ثبت نشده است.
        </div>
      ) : (
        <div className="space-y-4">
          {companies.map((c) => (
            <div key={c.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-800">
                      {c.name}
                    </span>
                    <span className={`badge ${statusBadge[c.status]}`}>
                      {statusLabel[c.status]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400" dir="ltr">
                    /app/{c.slug} · {c.user_count}/{c.max_users} کاربر
                  </div>
                  <div className="mt-1.5"><SyncStatus view={sync[c.id]} /></div>
                </div>

                <div className="flex items-center gap-2">
                  <form action={resyncCompanyAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-ghost" title="شرکت و همه افرادش دوباره به Keycloak و Odoo فرستاده می‌شوند">همگام‌سازی دوباره</button>
                  </form>
                  <form action={setCompanyStatusAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={c.status === "active" ? "suspended" : "active"}
                    />
                    <button
                      className={c.status === "active" ? "btn-danger" : "btn-ghost"}
                    >
                      {c.status === "active" ? "تعلیق دسترسی" : "فعال‌سازی"}
                    </button>
                  </form>
                </div>
              </div>

              <form
                action={updateCompanyAction}
                className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
              >
                <input type="hidden" name="id" value={c.id} />
                <div>
                  <label className="label">پلن</label>
                  <select name="plan" defaultValue={c.plan} className="input">
                    <option value="trial">آزمایشی</option>
                    <option value="standard">استاندارد</option>
                    <option value="pro">حرفه‌ای</option>
                    <option value="enterprise">سازمانی</option>
                  </select>
                </div>
                <div>
                  <label className="label">حداکثر کاربر</label>
                  <input
                    type="number"
                    name="maxUsers"
                    defaultValue={c.max_users}
                    min={1}
                    className="input w-32"
                  />
                </div>
                <button className="btn-ghost">ذخیره تغییرات</button>
              </form>

              <form
                action={setCompanyAppsAction}
                className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4"
              >
                <input type="hidden" name="id" value={c.id} />
                <span className="label mb-0">سامانه‌های سیمرغ</span>
                {APPS.map((a) => (
                  <label key={a.key} className="flex items-center gap-1.5 text-sm text-slate-700" title={a.note}>
                    <input type="checkbox" name={`app_${a.key}`} defaultChecked={!!c.apps?.[a.key]} className="h-4 w-4" />
                    {a.label}
                  </label>
                ))}
                <button className="btn-ghost" title="خاموش کردن یک سامانه، دسترسی همه افراد شرکت به آن را می‌گیرد">ذخیره سامانه‌ها</button>
              </form>

              {odooCompanies && (
                <form
                  action={linkOdooCompanyAction}
                  className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
                >
                  <input type="hidden" name="slug" value={c.slug} />
                  <div>
                    <label className="label">شرکت متناظر در Odoo</label>
                    <select name="odooCompanyId" defaultValue={c.odoo_company_id ?? ""} className="input">
                      <option value="">— متصل نیست —</option>
                      {!c.odoo_company_id && <option value="new">＋ ساخت شرکت جدید در Odoo با نام «{c.name}»</option>}
                      {odooCompanies.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} (#{o.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn-ghost">ذخیره اتصال</button>
                </form>
              )}
              {searchParams.erp_slug === c.slug && searchParams.erp_error && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.erp_error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
