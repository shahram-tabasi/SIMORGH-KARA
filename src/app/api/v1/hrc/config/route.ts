import { createHash } from "crypto";
import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { loadPolicy } from "@/lib/hrc/privacy";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/config
 *
 * هرچه دستگاه برای کارکردن لازم دارد: ناحیه‌ها، فاصلهٔ ارسال، سیاست پایش و یک
 * اثرانگشت از قوانین. اپ هیچ منطق تصمیمی ندارد؛ ناحیه‌ها را فقط برای ژئوفنس
 * محلی (تا وقتی شبکه نیست) می‌گیرد و اثرانگشت به آن می‌گوید کِی دوباره بپرسد.
 *
 * The cadence follows the company's own privacy mode: a company that monitors
 * only during shifts has no reason to make phones report every 30 seconds
 * around the clock.
 */
export const GET = route(async (req) => {
  const ctx = await authenticateDevice(req);

  return withTenant(ctx.schema, async (tx) => {
    const policy = await loadPolicy(tx);
    const zones = await tx<
      {
        id: string;
        name: string;
        zone_type: string;
        shape: string;
        coord_mode: string;
        polygon: unknown;
        center_lat: number | null;
        center_lng: number | null;
        radius_m: number | null;
        alert_on_enter: boolean;
        alert_on_exit: boolean;
      }[]
    >`
      SELECT id, name, zone_type, shape, coord_mode, polygon, center_lat,
             center_lng, radius_m, alert_on_enter, alert_on_exit
      FROM hrc_zones WHERE is_active = true
    `;
    const rules = await tx<{ code: string; version: number; updated_at: string }[]>`
      SELECT code, version, updated_at FROM hrc_rules WHERE enabled = true ORDER BY code
    `;
    const [site] = await tx<
      { title: string; north: number | null; south: number | null; east: number | null; west: number | null }[]
    >`SELECT title, north, south, east, west FROM hrc_map WHERE id = 1`;

    const rulesDigest = createHash("sha256")
      .update(rules.map((r) => `${r.code}:${r.version}:${r.updated_at}`).join("|"))
      .digest("hex")
      .slice(0, 16);

    const shiftOnly = policy.monitoring_mode === "SHIFT_ONLY";
    return {
      device: {
        id: ctx.deviceId,
        uid: ctx.deviceUid,
        type: ctx.deviceType,
      },
      member: { id: ctx.memberId, name: ctx.memberName },
      company: { slug: ctx.slug, name: ctx.name },
      policy: {
        monitoringMode: policy.monitoring_mode,
        consentRequired: policy.consent_required,
      },
      cadence: {
        locationSeconds: shiftOnly ? 60 : 120,
        healthSeconds: 300,
        heartbeatSeconds: 300,
        // How long the app may keep queueing while offline before it warns
        // the wearer that nobody is receiving their data.
        offlineWarnMinutes: 15,
      },
      site: site ?? null,
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        zoneType: z.zone_type,
        shape: z.shape,
        coordMode: z.coord_mode,
        polygon: Array.isArray(z.polygon) ? z.polygon : [],
        centerLat: z.center_lat,
        centerLng: z.center_lng,
        radiusM: z.radius_m,
        alertOnEnter: z.alert_on_enter,
        alertOnExit: z.alert_on_exit,
      })),
      rulesDigest,
      serverTime: new Date().toISOString(),
    };
  });
});
