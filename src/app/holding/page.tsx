import Link from "next/link";
import { requireHolding } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";

interface Section {
  id: string;
  name: string;
  slug: string;
  status: string;
  max_users: number;
  manager_name: string | null;
  manager_email: string | null;
  user_count: number;
}

const statusLabel: Record<string, string> = {
  active: "فعال",
  suspended: "معلق",
  pending: "در انتظار",
};

export default async function HoldingHome() {
  const { holding } = await requireHolding();

  const [{ max_companies }] = await sql<{ max_companies: number }[]>`
    SELECT max_companies FROM platform.holdings WHERE id = ${holding.id}
  `;

  const sections = await sql<Section[]>`
    SELECT c.id, c.name, c.slug, c.status, c.max_users,
           (SELECT full_name FROM platform.user_accounts ua
            WHERE ua.company_id = c.id ORDER BY ua.created_at LIMIT 1) AS manager_name,
           (SELECT email FROM platform.user_accounts ua
            WHERE ua.company_id = c.id ORDER BY ua.created_at LIMIT 1) AS manager_email,
           (SELECT count(*)::int FROM platform.user_accounts ua
            WHERE ua.company_id = c.id) AS user_count
    FROM platform.companies c
    WHERE c.holding_id = ${holding.id}
    ORDER BY c.created_at
  `;
  const atLimit = sections.length >= max_companies;

  return (
    <>
      <PageHeader
        title={`شرکت‌های ${holding.name}`}
        description="هر شرکت یک سازمان مستقل با مدیر خودش است؛ شرکت از معاونت‌ها و بخش‌ها تشکیل می‌شود"
      />
      <div className="mb-4 flex items-center gap-3">
        {atLimit ? (
          <span className="btn-primary pointer-events-none opacity-50">＋ افزودن شرکت جدید</span>
        ) : (
          <Link href="/holding/companies/new" className="btn-primary">
            ＋ افزودن شرکت جدید
          </Link>
        )}
        <span className={`badge ${atLimit ? "bg-amber-100 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
          {sections.length} از {max_companies} شرکت
        </span>
        {atLimit && (
          <span className="text-xs text-amber-600">سقف پر شده — برای افزایش با مدیر سامانه هماهنگ کنید.</span>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="card text-sm text-slate-400">
          هنوز شرکتی ثبت نشده است. با «افزودن شرکت جدید» شروع کنید.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sections.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-800">{s.name}</div>
                <span
                  className={`badge ${s.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {statusLabel[s.status] ?? s.status}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                مدیر شرکت: {s.manager_name ?? "—"}
                <span className="mr-1 text-slate-400" dir="ltr">
                  ({s.manager_email ?? "—"})
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {s.user_count} کاربر از {s.max_users}
              </div>
              <div className="mt-3">
                <Link
                  href={`/app/${s.slug}`}
                  className="text-xs text-brand-600 hover:underline"
                >
                  ورود به پنل شرکت ←
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
