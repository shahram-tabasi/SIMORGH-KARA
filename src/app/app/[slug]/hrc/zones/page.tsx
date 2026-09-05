import { requireTenant, guardPanel } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { ZONE_KINDS } from "@/lib/hrc";
import { loadZones } from "../data";
import { ZoneForm } from "./ZoneForm";
import { deleteZoneAction } from "../actions";

export default async function ZonesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.map.manage");
  const zones = await loadZones(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="ناحیه‌بندی نقشه (ژئوفنس)"
        description="ناحیه‌های امن، ممنوعه، پرخطر و نقاط تجمع؛ ورود یا خروج از هر ناحیه می‌تواند هشدار بسازد"
      />

      <div className="mb-6">
        <ZoneForm slug={params.slug} />
      </div>

      <div className="space-y-3">
        {zones.length === 0 ? (
          <div className="card text-sm text-slate-400">هنوز ناحیه‌ای تعریف نشده است.</div>
        ) : (
          zones.map((z) => (
            <div key={z.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded"
                    style={{ backgroundColor: z.color }}
                  />
                  <span className="font-semibold text-slate-800">{z.name}</span>
                  <span className="badge bg-slate-100 text-slate-600">
                    {ZONE_KINDS[z.kind as keyof typeof ZONE_KINDS] ?? z.kind}
                  </span>
                  {z.alert_on_enter && (
                    <span className="badge bg-amber-100 text-amber-700">هشدار ورود</span>
                  )}
                  {z.alert_on_exit && (
                    <span className="badge bg-amber-100 text-amber-700">هشدار خروج</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {z.coord_mode === "geo" ? "مختصات جغرافیایی" : "مختصات نقشه (٪)"} ·{" "}
                  {Array.isArray(z.polygon) ? z.polygon.length : 0} نقطه
                  {z.note ? ` · ${z.note}` : ""}
                </div>
              </div>
              <form action={deleteZoneAction}>
                <input type="hidden" name="slug" value={params.slug} />
                <input type="hidden" name="zoneId" value={z.id} />
                <button className="btn-danger">حذف ناحیه</button>
              </form>
            </div>
          ))
        )}
      </div>
    </>
  );
}
