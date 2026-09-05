import { withTenant } from "@/lib/db";
import { route } from "@/lib/hrc/http";
import { requireOperator, must } from "@/lib/hrc/operator";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hrc/devices — تابلوی دستگاه‌ها.
 *
 * «آنلاین» یعنی ضربانی تازه‌تر از آستانهٔ خودِ شرکت رسیده باشد؛ سکوت طولانی
 * همان چیزی است که رویداد DEVICE_OFFLINE از آن ساخته می‌شود.
 */
export const GET = route(async (req) => {
  const ctx = await requireOperator(req);
  must(ctx, "hrc.devices.manage", "hrc.monitor");

  return withTenant(ctx.schema, async (tx) => {
    const [thr] = await tx<{ offline_minutes: number }[]>`
      SELECT offline_minutes FROM hrc_thresholds WHERE id = 1
    `;
    const minutes = thr?.offline_minutes ?? 15;
    const devices = await tx`
      SELECT d.id, d.device_uid, d.device_type, d.manufacturer, d.model,
             d.os_version, d.app_version, d.status, d.battery, d.network,
             d.last_heartbeat_at, d.enrolled_at, d.is_simulated,
             d.public_key IS NOT NULL AS has_key,
             g.device_uid AS gateway_uid,
             m.id AS member_id, m.full_name AS member_name,
             (d.last_heartbeat_at IS NOT NULL
              AND d.last_heartbeat_at > now() - make_interval(mins => ${minutes})) AS online
      FROM hrc_devices d
      LEFT JOIN hrc_devices g ON g.id = d.gateway_device_id
      LEFT JOIN hrc_device_assignments a
             ON a.device_id = d.id AND a.unassigned_at IS NULL
      LEFT JOIN members m ON m.id = COALESCE(a.member_id, d.member_id)
      ORDER BY d.status, d.last_heartbeat_at DESC NULLS LAST
    `;
    return { devices, offlineAfterMinutes: minutes };
  });
});
