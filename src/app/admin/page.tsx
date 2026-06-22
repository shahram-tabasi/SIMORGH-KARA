import Link from "next/link";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";

async function getStats() {
  const [stats] = await sql<
    { companies: number; active: number; accounts: number }[]
  >`
    SELECT
      (SELECT count(*) FROM platform.companies)::int AS companies,
      (SELECT count(*) FROM platform.companies WHERE status='active')::int AS active,
      (SELECT count(*) FROM platform.user_accounts WHERE NOT is_platform_admin)::int AS accounts
  `;
  return stats;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-3xl font-bold text-brand-700">
        {value.toLocaleString("fa-IR")}
      </div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default async function AdminDashboard() {
  const stats = await getStats();
  return (
    <>
      <PageHeader
        title="داشبورد مدیریت پلتفرم"
        description="نمای کلی شرکت‌ها و کاربران سامانه"
        action={
          <Link href="/admin/companies/new" className="btn-primary">
            ＋ افزودن شرکت
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="کل شرکت‌ها" value={stats.companies} />
        <StatCard label="شرکت‌های فعال" value={stats.active} />
        <StatCard label="کل کاربران" value={stats.accounts} />
      </div>

      <div className="mt-8">
        <Link href="/admin/companies" className="text-sm text-brand-600 hover:underline">
          مشاهده و مدیریت همه شرکت‌ها ←
        </Link>
      </div>
    </>
  );
}
