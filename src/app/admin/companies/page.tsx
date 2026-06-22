import Link from "next/link";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { setCompanyStatusAction, updateCompanyAction } from "../actions";

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  max_users: number;
  user_count: number;
  created_at: string;
}

async function getCompanies(): Promise<CompanyRow[]> {
  return sql<CompanyRow[]>`
    SELECT c.id, c.name, c.slug, c.status, c.plan, c.max_users,
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

export default async function CompaniesPage() {
  const companies = await getCompanies();

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
                </div>

                <div className="flex items-center gap-2">
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
            </div>
          ))}
        </div>
      )}
    </>
  );
}
