import { requireTenant } from "@/lib/session";
import { todayJalali, isoDate } from "@/lib/jalali";
import { loadMonthSheet } from "./data";
import { SheetTable } from "./SheetTable";
import { PunchWidget } from "./PunchWidget";

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { y?: string; m?: string };
}) {
  const ctx = await requireTenant(params.slug);
  const today = todayJalali();
  const jy = Number(searchParams.y) || today.jy;
  const jm = Number(searchParams.m) || today.jm;

  const sheet = await loadMonthSheet(
    ctx.company.schema,
    ctx.member.memberId,
    jy,
    jm
  );

  const todayIso = isoDate(new Date());
  const todayRow = sheet.days.find((d) => d.iso === todayIso);

  return (
    <>
      <div className="mb-3">
        <h1 className="text-lg font-bold text-slate-800">حضور و غیاب</h1>
        <p className="text-xs text-slate-400">ثبت ورود/خروج و کارنامهٔ ماهانه</p>
      </div>

      <div className="mb-3">
        <PunchWidget
          slug={params.slug}
          punches={
            todayRow?.punches.map((p) => ({
              at: p.at.toISOString(),
              kind: p.kind,
            })) ?? []
          }
          workedMinutes={todayRow?.result.worked ?? 0}
        />
      </div>

      <SheetTable
        sheet={sheet}
        jy={jy}
        jm={jm}
        navBase={`/app/${params.slug}/attendance`}
      />
    </>
  );
}
