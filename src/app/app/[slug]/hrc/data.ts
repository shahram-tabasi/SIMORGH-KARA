import "server-only";
import { withTenant } from "@/lib/db";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/hrc";

export interface PersonStatus {
  member_id: string;
  full_name: string;
  title: string | null;
  serial: string | null;
  device_active: boolean | null;
  recorded_at: string | null;
  heart_rate: number | null;
  spo2: number | null;
  body_temp: string | null;
  steps: number | null;
  battery: number | null;
  motion: string | null;
  lat: number | null;
  lng: number | null;
  x: number | null;
  y: number | null;
  source: string | null;
  zone_name: string | null;
  zone_color: string | null;
  open_alerts: number;
}

export interface MapSettings {
  title: string;
  image_url: string | null;
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}

export interface ZoneRow {
  id: string;
  name: string;
  kind: string;
  color: string;
  coord_mode: string;
  polygon: [number, number][];
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  note: string | null;
}

/**
 * The live picture the monitor and the map both need: everyone's latest reading
 * with their open-alert count. `memberId` narrows it to one person for users who
 * only hold `hrc.view` (پایش خودم).
 */
export async function loadPeople(
  schema: string,
  memberId?: string
): Promise<PersonStatus[]> {
  return withTenant(schema, async (tx) =>
    tx<PersonStatus[]>`
      SELECT m.id AS member_id, m.full_name, m.title,
             d.serial, d.is_active AS device_active,
             r.recorded_at::text, r.heart_rate, r.spo2, r.body_temp, r.steps,
             r.battery, r.motion, r.lat, r.lng, r.x, r.y, r.source,
             z.name AS zone_name, z.color AS zone_color,
             (SELECT count(*)::int FROM hrc_alerts a
              WHERE a.member_id = m.id AND a.status IN ('open','ack','dispatched'))
               AS open_alerts
      FROM members m
      LEFT JOIN hrc_devices d ON d.member_id = m.id
      LEFT JOIN LATERAL (
        SELECT * FROM hrc_readings hr
        WHERE hr.member_id = m.id
        ORDER BY hr.recorded_at DESC LIMIT 1
      ) r ON true
      LEFT JOIN hrc_zones z ON z.id = r.zone_id
      WHERE m.status = 'active'
        AND ${memberId ? tx`m.id = ${memberId}` : tx`true`}
      ORDER BY (r.recorded_at IS NULL), r.recorded_at DESC, m.full_name
    `
  );
}

export async function loadThresholds(schema: string): Promise<Thresholds> {
  return withTenant(schema, async (tx) => {
    const [t] = await tx<Thresholds[]>`SELECT * FROM hrc_thresholds WHERE id = 1`;
    return t ?? DEFAULT_THRESHOLDS;
  });
}

export async function loadMap(schema: string): Promise<MapSettings> {
  return withTenant(schema, async (tx) => {
    const [m] = await tx<MapSettings[]>`
      SELECT title, image_url, north, south, east, west FROM hrc_map WHERE id = 1
    `;
    return (
      m ?? {
        title: "نقشهٔ شرکت",
        image_url: null,
        north: null,
        south: null,
        east: null,
        west: null,
      }
    );
  });
}

export async function loadZones(schema: string): Promise<ZoneRow[]> {
  return withTenant(schema, async (tx) =>
    tx<ZoneRow[]>`
      SELECT id, name, kind, color, coord_mode, polygon, alert_on_enter,
             alert_on_exit, note
      FROM hrc_zones ORDER BY name
    `
  );
}

/** Minutes since a timestamp, or null when there is none. */
export function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}
