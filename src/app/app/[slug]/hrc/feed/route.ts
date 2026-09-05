import { NextResponse } from "next/server";
import { requireTenant, ensureModule } from "@/lib/session";
import { healthStatus, projectToMap } from "@/lib/hrc";
import { loadPeople, loadThresholds, loadMap, loadZones, minutesSince } from "../data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live feed for the company map. Positions are returned already projected onto
 * the map image (x/y percentages), so the browser only paints dots.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "hrc");
  if (!ctx.member.permissions.has("hrc.view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const canMonitor = ctx.member.permissions.has("hrc.monitor");

  const [thresholds, map, zones, people] = await Promise.all([
    loadThresholds(ctx.company.schema),
    loadMap(ctx.company.schema),
    loadZones(ctx.company.schema),
    loadPeople(ctx.company.schema, canMonitor ? undefined : ctx.member.memberId),
  ]);

  const points = people.map((p) => {
    const mins = minutesSince(p.recorded_at);
    const status = healthStatus(
      p.recorded_at
        ? {
            heart_rate: p.heart_rate,
            spo2: p.spo2,
            body_temp: p.body_temp === null ? null : Number(p.body_temp),
            battery: p.battery,
            motion: p.motion,
          }
        : null,
      thresholds,
      mins
    );
    // Prefer an explicit plan position; fall back to projecting GPS on the map.
    const projected =
      p.x !== null && p.y !== null
        ? { x: p.x, y: p.y }
        : projectToMap(p.lat, p.lng, map);
    return {
      memberId: p.member_id,
      name: p.full_name,
      title: p.title,
      level: status.level,
      label: status.label,
      heartRate: p.heart_rate,
      spo2: p.spo2,
      bodyTemp: p.body_temp,
      battery: p.battery,
      zone: p.zone_name,
      minutes: mins,
      lat: p.lat,
      lng: p.lng,
      openAlerts: p.open_alerts,
      x: projected?.x ?? null,
      y: projected?.y ?? null,
    };
  });

  return NextResponse.json({
    map,
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind,
      color: z.color,
      coordMode: z.coord_mode,
      // raw lat/lng for the real map; the x/y below is for the plan view
      latlngs: z.coord_mode === "geo" && Array.isArray(z.polygon) ? z.polygon : [],
      // Zones drawn in geo mode are projected onto the image the same way.
      points: (Array.isArray(z.polygon) ? z.polygon : []).map((pt) => {
        const [a, b] = pt as [number, number];
        if (z.coord_mode === "plan") return { x: a, y: b };
        const pr = projectToMap(a, b, map);
        return pr ? { x: pr.x, y: pr.y } : null;
      }),
    })),
    points,
  });
}
