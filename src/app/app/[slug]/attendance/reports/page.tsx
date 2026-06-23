import Link from "next/link";
import { requireTenant, ensurePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import {
  todayJalali,
  JALALI_MONTHS,
  toFaDigits,
} from "@/lib/jalali";
import { formatDuration } from "@/lib/attendance";
import { loadMonthSummaries } from "../data";
import { PrintButton } from "./PrintButton";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { y?: string; m?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const today = todayJalali();
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const rows = await loadMonthSummaries(ctx.company.schema, jy, jm);

  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 };
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };

  const grand = rows.reduce(
    (a, r) => ({
      present: a.present + r.presentDays,
      absent: a.absent + r.absentDays,
      leave: a.leave + r.leaveDays,
      worked: a.worked + r.workedMinutes,
      late: a.late + r.lateMinutes,
    }),
    { present: 0, absent: 0, leave: 0, worked: 0, late: 0 }
  );

  return (
    <>
      <PageHeader
        title="گزارش حضور"
        description="خلاصه ماهانه حضور و غیاب همه اعضا"
      />

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={`?y=${prev.y}&m=${prev.m}`} className="btn-ghost">
              ‹ ماه قبل
            </Link>
            <span className="text-lg font-bold text-slate-800">
              {JALALI_MONTHS[jm - 1]} {toFaDigits(jy)}
            </span>
            <Link href={`?y=${next.y}&m=${next.m}`} className="btn-ghost">
              ماه بعد ›
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/app/${params.slug}/attendance/reports/export?y=${jy}&m=${jm}`}
              className="btn-ghost print:hidden"
            >
              ⬇️ خروجی CSV
            </a>
            <PrintButton />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                <th className="pb-2 font-medium">عضو</th>
                <th className="pb-2 font-medium">روزهای حاضر</th>
                <th className="pb-2 font-medium">غایب</th>
                <th className="pb-2 font-medium">مرخصی/مأموریت</th>
                <th className="pb-2 font-medium">مجموع کارکرد</th>
                <th className="pb-2 font-medium">مجموع تأخیر</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{r.name}</td>
                  <td className="py-2">{toFaDigits(r.presentDays)}</td>
                  <td className="py-2 text-red-600">{toFaDigits(r.absentDays)}</td>
                  <td className="py-2">{toFaDigits(r.leaveDays)}</td>
                  <td className="py-2">{formatDuration(r.workedMinutes)}</td>
                  <td className="py-2 text-amber-600">
                    {formatDuration(r.lateMinutes)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    عضوی یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                  <td className="py-2">جمع کل</td>
                  <td className="py-2">{toFaDigits(grand.present)}</td>
                  <td className="py-2">{toFaDigits(grand.absent)}</td>
                  <td className="py-2">{toFaDigits(grand.leave)}</td>
                  <td className="py-2">{formatDuration(grand.worked)}</td>
                  <td className="py-2">{formatDuration(grand.late)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
