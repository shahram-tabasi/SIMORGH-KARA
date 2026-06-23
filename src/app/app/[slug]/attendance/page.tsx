import { requireTenant } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
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
      <PageHeader
        title="حضور و غیاب"
        description="ثبت ورود و خروج و مشاهده کارنامه ماهانه شما"
      />

      <div className="mb-6">
        <PunchWidget
          slug={params.slug}
          checkInIso={todayRow?.checkIn?.toISOString() ?? null}
          checkOutIso={todayRow?.checkOut?.toISOString() ?? null}
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
