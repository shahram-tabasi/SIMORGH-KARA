import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ModulePicker } from "@/components/ModulePicker";
import { AccountEditor } from "@/components/AccountEditor";
import { normalizeModules } from "@/lib/modules";
import {
  setHoldingMaxCompaniesAction,
  setHoldingModulesAction,
  updateManagedAccountAction,
  resetManagedPasswordAction,
  setAccountStatusAction,
} from "../actions";

interface Row {
  id: string;
  name: string;
  slug: string;
  admin_id: string | null;
  admin_email: string | null;
  admin_name: string | null;
  admin_status: string | null;
  company_count: number;
  max_companies: number;
  modules: string[] | null;
}

export default async function HoldingsPage() {
  await requirePlatformAdmin();
  const holdings = await sql<Row[]>`
    SELECT h.id, h.name, h.slug, h.max_companies, h.modules,
           adm.id AS admin_id, adm.email AS admin_email,
           adm.full_name AS admin_name, adm.status AS admin_status,
           (SELECT count(*)::int FROM platform.companies c WHERE c.holding_id = h.id) AS company_count
    FROM platform.holdings h
    LEFT JOIN LATERAL (
      SELECT ua.id, ua.email, ua.full_name, ua.status
      FROM platform.user_accounts ua
      WHERE ua.holding_id = h.id AND ua.is_holding_admin
      ORDER BY ua.created_at LIMIT 1
    ) adm ON true
    ORDER BY h.created_at DESC
  `;

  return (
    <>
      <PageHeader
        title="هولدینگ‌ها"
        description="هر هولدینگ مجموعه‌ای از شرکت‌هاست که مدیر هولدینگ آن‌ها را می‌سازد و اداره می‌کند"
      />
      <div className="mb-4">
        <Link href="/admin/holdings/new" className="btn-primary">
          ＋ افزودن هولدینگ
        </Link>
      </div>

      {holdings.length === 0 ? (
        <div className="card text-sm text-slate-400">هنوز هولدینگی ثبت نشده است.</div>
      ) : (
        <div className="space-y-3">
          {holdings.map((h) => (
            <div key={h.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-800">{h.name}</div>
                <div className="text-xs text-slate-400" dir="ltr">
                  {h.admin_email ?? "—"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`badge ${h.company_count >= h.max_companies ? "bg-amber-100 text-amber-700" : "bg-brand-50 text-brand-700"}`}
                >
                  {h.company_count} از {h.max_companies} شرکت
                </span>
                <form action={setHoldingMaxCompaniesAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={h.id} />
                  <label className="text-xs text-slate-500">سقف:</label>
                  <input
                    name="maxCompanies"
                    type="number"
                    min={1}
                    defaultValue={h.max_companies}
                    className="input w-20 !py-1 text-sm"
                    dir="ltr"
                  />
                  <button className="text-xs text-brand-600 hover:underline">ثبت</button>
                </form>
              </div>
              </div>

              <form
                action={setHoldingModulesAction}
                className="mt-4 border-t border-slate-100 pt-4"
              >
                <input type="hidden" name="id" value={h.id} />
                <div className="mb-2 text-xs font-medium text-slate-500">
                  پنل‌های مجاز هولدینگ — مدیر هولدینگ فقط می‌تواند همین‌ها را به
                  شرکت‌هایش بدهد؛ پنلی که اینجا برداشته شود از شرکت‌های آن
                  هولدینگ هم برداشته می‌شود
                </div>
                <ModulePicker selected={normalizeModules(h.modules)} />
                <div className="mt-3 flex justify-end">
                  <button className="btn-ghost">ذخیره پنل‌های مجاز</button>
                </div>
              </form>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 text-xs font-medium text-slate-500">
                  حساب مدیر هولدینگ — اصلاح ایمیل و بازنشانی رمز
                </div>
                {h.admin_id ? (
                  <AccountEditor
                    saveAction={updateManagedAccountAction}
                    resetAction={resetManagedPasswordAction}
                    statusAction={setAccountStatusAction}
                    account={{
                      id: h.admin_id,
                      full_name: h.admin_name ?? "",
                      email: h.admin_email ?? "",
                      username: null,
                      status: h.admin_status ?? "active",
                      scoped: false,
                    }}
                  />
                ) : (
                  <div className="text-xs text-slate-400">
                    برای این هولدینگ حساب مدیری ثبت نشده است.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
