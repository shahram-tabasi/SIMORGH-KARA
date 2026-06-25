import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { toFaDigits } from "@/lib/jalali";
import { deleteEnrollmentAction } from "./actions";

interface Row {
  id: string;
  full_name: string;
  samples: number;
}

export default async function FacePage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const rows = await withTenant(ctx.company.schema, async (tx) =>
    tx<Row[]>`
      SELECT m.id, m.full_name,
             count(f.*)::int AS samples
      FROM members m
      LEFT JOIN face_embeddings f ON f.member_id = m.id
      WHERE m.status = 'active'
      GROUP BY m.id, m.full_name
      ORDER BY (count(f.*) = 0), m.full_name
    `
  );
  const enrolled = rows.filter((r) => r.samples > 0).length;

  return (
    <>
      <PageHeader
        title="ثبت چهره (هویت‌سنجی)"
        description="وضعیت ثبت چهرهٔ اعضا برای تشخیص خودکار در دستگاه/اپ نگهبان"
      />

      <div className="card max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            اعضا ({toFaDigits(enrolled)} از {toFaDigits(rows.length)} ثبت‌شده)
          </h3>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">{r.full_name}</span>
                {r.samples > 0 ? (
                  <span className="badge bg-green-100 text-green-700">
                    ✓ ثبت‌شده ({toFaDigits(r.samples)} نمونه)
                  </span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-400">ثبت‌نشده</span>
                )}
              </div>
              {r.samples > 0 && (
                <form action={deleteEnrollmentAction}>
                  <input type="hidden" name="slug" value={params.slug} />
                  <input type="hidden" name="memberId" value={r.id} />
                  <button className="text-xs text-red-600 hover:underline">حذف چهره</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          ثبت چهرهٔ اولیه از طریق <b>اپ نگهبان</b> (حالت «ثبت چهره») انجام می‌شود؛
          بردار چهره روی دستگاه محاسبه و به سرور ارسال می‌گردد. تطبیق با شباهت
          کسینوسی (آستانهٔ ۰.۶۲) انجام می‌شود.
        </p>
      </div>
    </>
  );
}
