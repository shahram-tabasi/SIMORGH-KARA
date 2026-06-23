import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { sql } from "@/lib/db";
import { PageHeader } from "@/components/Shell";

interface Row {
  id: string;
  name: string;
  slug: string;
  admin_email: string | null;
  company_count: number;
}

export default async function HoldingsPage() {
  await requirePlatformAdmin();
  const holdings = await sql<Row[]>`
    SELECT h.id, h.name, h.slug,
           (SELECT email FROM platform.user_accounts ua
            WHERE ua.holding_id = h.id AND ua.is_holding_admin LIMIT 1) AS admin_email,
           (SELECT count(*)::int FROM platform.companies c WHERE c.holding_id = h.id) AS company_count
    FROM platform.holdings h ORDER BY h.created_at DESC
  `;

  return (
    <>
      <PageHeader
        title="هولدینگ‌ها"
        description="هر هولدینگ مجموعه‌ای از شرکت‌ها (بخش‌ها) است که یک مدیر هولدینگ آن‌ها را اداره می‌کند"
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
            <div key={h.id} className="card flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-800">{h.name}</div>
                <div className="text-xs text-slate-400" dir="ltr">
                  {h.admin_email ?? "—"}
                </div>
              </div>
              <span className="badge bg-brand-50 text-brand-700">
                {h.company_count} شرکت
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
