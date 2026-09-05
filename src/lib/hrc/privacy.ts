import "server-only";
import type { TransactionSql } from "postgres";
import { pointInPolygon, distanceMeters } from "@/lib/hrc";

/**
 * دروازهٔ حریم خصوصی.
 *
 * A safety platform that tracks people all the time is a surveillance
 * platform. `hrc_policies.monitoring_mode` is the company's answer to «چه
 * موقع اجازه دارید موقعیت من را نگه دارید؟» and this module enforces it at
 * the point of ingest — a fix that policy forbids is never written to disk,
 * not merely hidden in the UI.
 *
 *   SHIFT_ONLY     فقط وقتی کارمند تردد ورود زده و هنوز خروج نزده
 *   FACILITY_ONLY  فقط وقتی داخل محوطهٔ شرکت یا یکی از ناحیه‌هاست
 *   ALWAYS         همیشه (باید آگاهانه انتخاب شود)
 */

export interface Policy {
  monitoring_mode: "SHIFT_ONLY" | "FACILITY_ONLY" | "ALWAYS";
  retention_location_days: number;
  retention_event_days: number;
  retention_heartbeat_days: number;
  retention_health_days: number;
  consent_required: boolean;
}

export const FALLBACK_POLICY: Policy = {
  monitoring_mode: "SHIFT_ONLY",
  retention_location_days: 90,
  retention_event_days: 365,
  retention_heartbeat_days: 30,
  retention_health_days: 180,
  consent_required: true,
};

export async function loadPolicy(tx: TransactionSql): Promise<Policy> {
  const [p] = await tx<Policy[]>`
    SELECT monitoring_mode, retention_location_days, retention_event_days,
           retention_heartbeat_days, retention_health_days, consent_required
    FROM hrc_policies WHERE id = 1
  `;
  return p ?? FALLBACK_POLICY;
}

/** Is this member currently clocked in? (last punch of today is an «in») */
export async function onShift(
  tx: TransactionSql,
  memberId: string
): Promise<boolean> {
  const [row] = await tx<{ kind: string }[]>`
    SELECT kind FROM attendance_punches
    WHERE member_id = ${memberId}
      AND punched_at > now() - interval '24 hours'
      -- A clock-out stamped for later this evening (planned or back-office
      -- entered) does not mean the person is off shift *now*.
      AND punched_at <= now()
    ORDER BY punched_at DESC LIMIT 1
  `;
  return row?.kind === "in";
}

export interface ZoneRow {
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
  is_active: boolean;
}

export async function loadZones(tx: TransactionSql): Promise<ZoneRow[]> {
  return tx<ZoneRow[]>`
    SELECT id, name, zone_type, shape, coord_mode, polygon, center_lat,
           center_lng, radius_m, alert_on_enter, alert_on_exit, is_active
    FROM hrc_zones WHERE is_active = true
  `;
}

function polygonOf(zone: ZoneRow): [number, number][] {
  const p = zone.polygon;
  if (!Array.isArray(p)) return [];
  return p.filter(
    (pt): pt is [number, number] =>
      Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number"
  );
}

/** Which zone (if any) a geographic fix falls inside. Circles and polygons. */
export function zoneAt(
  zones: ZoneRow[],
  lat: number,
  lng: number
): ZoneRow | null {
  for (const z of zones) {
    if (z.coord_mode !== "geo") continue;
    if (z.shape === "CIRCLE") {
      if (z.center_lat == null || z.center_lng == null || z.radius_m == null) continue;
      const d = distanceMeters({ lat, lng }, { lat: z.center_lat, lng: z.center_lng });
      if (d <= z.radius_m) return z;
    } else {
      const poly = polygonOf(z);
      if (poly.length >= 3 && pointInPolygon([lat, lng], poly)) return z;
    }
  }
  return null;
}

/** Zone lookup for plan-relative (x, y in %) positions from indoor beacons. */
export function planZoneAt(
  zones: ZoneRow[],
  x: number,
  y: number
): ZoneRow | null {
  for (const z of zones) {
    if (z.coord_mode !== "plan") continue;
    const poly = polygonOf(z);
    if (poly.length >= 3 && pointInPolygon([x, y], poly)) return z;
  }
  return null;
}

export interface SiteBounds {
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}

export function insideSite(b: SiteBounds, lat: number, lng: number): boolean {
  if (b.north == null || b.south == null || b.east == null || b.west == null) {
    // The company never drew its site. Refusing everything would silently
    // break monitoring, so fall back to "inside" and let the zone check decide.
    return true;
  }
  return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
}

export interface GateInput {
  memberId: string;
  lat?: number | null;
  lng?: number | null;
  zone: ZoneRow | null;
  site: SiteBounds;
}

export type GateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Decide whether one position fix may be stored. Called per fix, because a
 * batch uploaded after a shift ends may legitimately contain fixes from
 * during the shift and fixes from after it.
 */
export async function gateLocation(
  tx: TransactionSql,
  policy: Policy,
  input: GateInput
): Promise<GateResult> {
  if (policy.monitoring_mode === "ALWAYS") return { allowed: true };

  if (policy.monitoring_mode === "SHIFT_ONLY") {
    return (await onShift(tx, input.memberId))
      ? { allowed: true }
      : { allowed: false, reason: "outside_shift" };
  }

  // FACILITY_ONLY
  if (input.zone) return { allowed: true };
  if (input.lat == null || input.lng == null) return { allowed: true }; // plan coords are indoor by definition
  return insideSite(input.site, input.lat, input.lng)
    ? { allowed: true }
    : { allowed: false, reason: "outside_facility" };
}

/**
 * An emergency is never gated. If someone presses SOS off-site or off-shift,
 * the company still has to know — this is the one place where safety
 * outranks the privacy mode, and it is deliberate.
 */
export function alwaysAllowed(eventType: string): boolean {
  return eventType === "SOS" || eventType === "FALL_DETECTED";
}
