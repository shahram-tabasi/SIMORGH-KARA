import Link from "next/link";
import { requireTenant, guardPanel } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { ZONE_KINDS } from "@/lib/hrc";
import { loadZones } from "../data";
import { LiveMap } from "./LiveMap";

export default async function HrcMapPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.view");
  const zones = await loadZones(ctx.company.schema);
  const base = `/app/${params.slug}/hrc`;

  return (
    <>
      <PageHeader
        title="نقشهٔ زندهٔ شرکت"
        description="موقعیت لحظه‌ای نفرات روی نقشهٔ سایت — رنگ هر نقطه وضعیت سلامت اوست"
        action={
          ctx.member.permissions.has("hrc.map.manage") ? (
            <Link href={`${base}/zones`} className="btn-ghost">
              مدیریت ناحیه‌ها
            </Link>
          ) : undefined
        }
      />

      <LiveMap slug={params.slug} />

      {zones.length > 0 && (
        <div className="card mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">ناحیه‌های نقشه</h3>
          <div className="flex flex-wrap gap-2">
            {zones.map((z) => (
              <span
                key={z.id}
                className="badge"
                style={{ backgroundColor: `${z.color}22`, color: z.color }}
              >
                {z.name} — {ZONE_KINDS[z.kind as keyof typeof ZONE_KINDS] ?? z.kind}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
