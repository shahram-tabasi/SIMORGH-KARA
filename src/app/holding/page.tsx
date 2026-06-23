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

  return (
    <>
      <PageHeader
        title={`بخش‌های ${holding.name}`}
        description="هر بخش یک شرکت مستقل با مدیر و کارکنان خودش است"
      />
      <div className="mb-4">
        <Link href="/holding/companies/new" className="btn-primary">
          ＋ افزودن بخش جدید
        </Link>
      </div>

      {sections.length === 0 ? (
        <div className="card text-sm text-slate-400">
          هنوز بخشی ثبت نشده است. با «افزودن بخش جدید» شروع کنید.
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
                مدیر بخش: {s.manager_name ?? "—"}
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
                  ورود به پنل بخش ←
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
