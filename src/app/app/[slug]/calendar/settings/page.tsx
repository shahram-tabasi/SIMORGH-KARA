import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { WEEKDAYS, toJalali, toFaDigits, todayJalali, JALALI_MONTHS } from "@/lib/jalali";
import { ScheduleForm } from "./ScheduleForm";
import { HolidayForm } from "./HolidayForm";
import {
  setDefaultScheduleAction,
  deleteScheduleAction,
  deleteHolidayAction,
} from "../actions";

interface Schedule {
  id: string;
  name: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  is_default: boolean;
}

function parseIso(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

async function loadData(schema: string) {
  return withTenant(schema, async (tx) => {
    const schedules = await tx<Schedule[]>`
      SELECT id, name, work_days, start_time, end_time, is_default
      FROM work_schedules ORDER BY is_default DESC, name
    `;
    const holidays = await tx<{ id: string; holiday_date: string; title: string; is_official: boolean }[]>`
      SELECT id, holiday_date::text, title, is_official
      FROM holidays ORDER BY holiday_date DESC
    `;
    return { schedules, holidays };
  });
}

export default async function CalendarSettingsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "calendar.manage");
  const { schedules, holidays } = await loadData(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="ساعت کاری و تعطیلات"
        description="تعریف شیفت‌های کاری شرکت و روزهای تعطیل"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ScheduleForm slug={params.slug} />
          {schedules.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{s.name}</span>
                  {s.is_default && (
                    <span className="badge bg-green-100 text-green-700">پیش‌فرض</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!s.is_default && (
                    <>
                      <form action={setDefaultScheduleAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs text-brand-600 hover:underline">
                          پیش‌فرض کن
                        </button>
                      </form>
                      <form action={deleteScheduleAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs text-red-600 hover:underline">
                          حذف
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                ساعت {toFaDigits(s.start_time)} تا {toFaDigits(s.end_time)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={i}
                    className={`badge ${
                      s.work_days.includes(i)
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <HolidayForm slug={params.slug} defaultYear={todayJalali().jy} />
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              تعطیلات ثبت‌شده
            </h3>
            {holidays.length === 0 ? (
              <div className="text-sm text-slate-400">تعطیلی ثبت نشده است.</div>
            ) : (
              <ul className="space-y-2">
                {holidays.map((h) => {
                  const j = toJalali(parseIso(h.holiday_date));
                  return (
                    <li
                      key={h.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm text-slate-700">
                        <span className="font-medium">
                          {toFaDigits(j.jd)} {JALALI_MONTHS[j.jm - 1]}{" "}
                          {toFaDigits(j.jy)}
                        </span>
                        <span className="mr-2 text-slate-500">— {h.title}</span>
                        {h.is_official && (
                          <span className="badge mr-2 bg-slate-200 text-slate-500">
                            رسمی
                          </span>
                        )}
                      </div>
                      {!h.is_official && (
                        <form action={deleteHolidayAction}>
                          <input type="hidden" name="slug" value={params.slug} />
                          <input type="hidden" name="id" value={h.id} />
                          <button className="text-xs text-red-600 hover:underline">
                            حذف
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
