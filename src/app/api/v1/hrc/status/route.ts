import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { authenticateDevice } from "@/lib/hrc/device-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/status
 *
 * وضعیت ایمنیِ خودِ همان کارمند — و فقط خودش. کارمند باید بتواند ببیند سامانه
 * دربارهٔ او چه می‌داند؛ این شفافیت همان چیزی است که پایش را قابل دفاع می‌کند.
 * توکن دستگاه فقط به دادهٔ صاحب همان دستگاه می‌رسد و هیچ راهی برای دیدن نفر
 * دیگری ندارد.
 */
export const GET = route(async (req) => {
  const ctx = await authenticateDevice(req);

  return withTenant(ctx.schema, async (tx) => {
    const [pos] = await tx<
      {
        recorded_at: string | null;
        latitude: number | null;
        longitude: number | null;
        accuracy_m: number | null;
        source: string | null;
        quality: string | null;
        zone_name: string | null;
      }[]
    >`
      SELECT p.recorded_at, p.latitude, p.longitude, p.accuracy_m, p.source,
             p.quality, z.name AS zone_name
      FROM hrc_last_position p
      LEFT JOIN hrc_zones z ON z.id = p.zone_id
      WHERE p.member_id = ${ctx.memberId}
    `;
    const [health] = await tx<
      {
        recorded_at: string;
        heart_rate: number | null;
        spo2: number | null;
        skin_temp: string | null;
        classification: string;
      }[]
    >`
      SELECT recorded_at, heart_rate, spo2, skin_temp, classification
      FROM hrc_health_readings
      WHERE member_id = ${ctx.memberId}
      ORDER BY recorded_at DESC LIMIT 1
    `;
    const open = await tx<
      { id: string; event_type: string; severity: string; status: string; occurred_at: string }[]
    >`
      SELECT id, event_type, severity, status, occurred_at
      FROM hrc_events
      WHERE member_id = ${ctx.memberId}
        AND status IN ('CREATED','ACKNOWLEDGED','INVESTIGATING')
      ORDER BY occurred_at DESC LIMIT 20
    `;
    const [device] = await tx<
      { status: string; battery: number | null; last_heartbeat_at: string | null }[]
    >`
      SELECT status, battery, last_heartbeat_at FROM hrc_devices WHERE id = ${ctx.deviceId}
    `;

    return {
      member: { id: ctx.memberId, name: ctx.memberName },
      device,
      lastPosition: pos ?? null,
      lastHealth: health ?? null,
      openEvents: open,
      serverTime: new Date().toISOString(),
    };
  });
});
