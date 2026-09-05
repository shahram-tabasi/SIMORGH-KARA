import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { loadThresholds, loadMap } from "../data";
import { saveThresholdsAction, saveMapAction } from "../actions";

export default async function HrcSettingsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.thresholds.manage");
  const t = await loadThresholds(ctx.company.schema);
  const map = await loadMap(ctx.company.schema);
  const teams = await withTenant(ctx.company.schema, async (tx) =>
    tx<{ id: string; name: string }[]>`
      SELECT id, name FROM hrc_teams WHERE is_active = true ORDER BY name
    `
  );
  const canMap = ctx.member.permissions.has("hrc.map.manage");

  return (
    <>
      <PageHeader
        title="تنظیمات HRC"
        description="آستانه‌های سلامت، قوانین هشدار و نقشهٔ سایت شرکت"
      />

      <form action={saveThresholdsAction} className="card mb-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">آستانه‌های سلامت</h3>
        <input type="hidden" name="slug" value={params.slug} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">حداقل ضربان</label>
            <input name="hrMin" type="number" defaultValue={t.hr_min} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">حداکثر ضربان</label>
            <input name="hrMax" type="number" defaultValue={t.hr_max} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">حداقل اکسیژن خون ٪</label>
            <input name="spo2Min" type="number" defaultValue={t.spo2_min} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">حداقل دما °C</label>
            <input name="tempMin" type="number" step="0.1" defaultValue={Number(t.temp_min)} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">حداکثر دما °C</label>
            <input name="tempMax" type="number" step="0.1" defaultValue={Number(t.temp_max)} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">بی‌حرکتی (دقیقه)</label>
            <input name="noMotion" type="number" defaultValue={t.no_motion_minutes} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">قطع ارتباط (دقیقه)</label>
            <input name="offline" type="number" defaultValue={t.offline_minutes} dir="ltr" className="input text-left" />
          </div>
          <div>
            <label className="label">باتری ضعیف ٪</label>
            <input name="batteryLow" type="number" defaultValue={t.battery_low} dir="ltr" className="input text-left" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="fallAlert" defaultChecked={t.fall_alert} className="h-4 w-4" />
            هشدار سقوط
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="geofenceAlert" defaultChecked={t.geofence_alert} className="h-4 w-4" />
            هشدار ورود/خروج ناحیه
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="autoDispatch" defaultChecked={t.auto_dispatch} className="h-4 w-4" />
            اعزام خودکار تیم در موارد بحرانی
          </label>
          <div>
            <label className="label">تیم آمادهٔ اعزام خودکار</label>
            <select
              name="autoDispatchTeam"
              defaultValue={t.auto_dispatch_team ?? ""}
              className="input !w-48"
            >
              <option value="">—</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary">ذخیرهٔ آستانه‌ها</button>
        </div>
      </form>

      {canMap && (
        <form action={saveMapAction} className="card space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">نقشهٔ شرکت</h3>
          <input type="hidden" name="slug" value={params.slug} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">عنوان نقشه</label>
              <input name="title" defaultValue={map.title} className="input" />
            </div>
            <div>
              <label className="label">نشانی تصویر نقشه</label>
              <input
                name="imageUrl"
                defaultValue={map.image_url ?? ""}
                dir="ltr"
                className="input text-left"
                placeholder="/map.png یا data:image/png;base64,…"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label">شمال (عرض بالا)</label>
              <input name="north" type="number" step="0.000001" defaultValue={map.north ?? ""} dir="ltr" className="input text-left" />
            </div>
            <div>
              <label className="label">جنوب (عرض پایین)</label>
              <input name="south" type="number" step="0.000001" defaultValue={map.south ?? ""} dir="ltr" className="input text-left" />
            </div>
            <div>
              <label className="label">غرب (طول چپ)</label>
              <input name="west" type="number" step="0.000001" defaultValue={map.west ?? ""} dir="ltr" className="input text-left" />
            </div>
            <div>
              <label className="label">شرق (طول راست)</label>
              <input name="east" type="number" step="0.000001" defaultValue={map.east ?? ""} dir="ltr" className="input text-left" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            با تعیین مختصات چهار گوشهٔ تصویر، موقعیت GPS هر نفر به‌صورت خودکار روی
            نقشه تصویر می‌شود. اگر سایت GPS ندارد، دستگاه‌ها می‌توانند مستقیماً
            مختصات x/y (درصدی از تصویر) بفرستند.
          </p>
          <div className="flex justify-end">
            <button className="btn-primary">ذخیرهٔ نقشه</button>
          </div>
        </form>
      )}
    </>
  );
}
