import { NextResponse } from "next/server";
import { sql, withTenant, type Tx } from "@/lib/db";
import { normalizeModules, hasModule } from "@/lib/modules";
import {
  evaluateReading,
  pointInPolygon,
  DEFAULT_THRESHOLDS,
  type Thresholds,
  type DetectedAlert,
} from "@/lib/hrc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Telemetry ingest for the HRC wearables (ساعت هوشمند کارکنان).
 *
 *   POST /api/<slug>/hrc/ingest
 *   Authorization: Bearer <device-token>
 *   {
 *     "at": "2026-06-25T08:01:00Z"?,      // default: now
 *     "heart_rate": 78, "spo2": 97, "body_temp": 36.8,
 *     "steps": 4210, "stress": 30, "battery": 64,
 *     "motion": "walking" | "still" | "running" | "fall",
 *     "sos": false,
 *     "lat": 35.7219, "lng": 51.3347, "accuracy": 8, "altitude": 1180,
 *     "x": 42.5, "y": 61.0,               // plan-relative %, when there is no GPS
 *     "source": "gps" | "lbs" | "wifi" | "beacon" | "lora",
 *     "member_id": "<uuid>"?              // only for shared/handheld devices
 *   }
 *
 * A batch is accepted too: { "readings": [ {…}, {…} ] }.
 *
 * The server stores the reading, resolves which map zone the person is in,
 * compares the vitals with the company thresholds and raises alerts. Alerts of
 * the same kind are not repeated while an earlier one is still being handled.
 */

interface Body {
  [k: string]: unknown;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const SOURCES = ["gps", "lbs", "wifi", "beacon", "lora", "manual"];

interface Zone {
  id: string;
  name: string;
  coord_mode: string;
  polygon: unknown;
  alert_on_enter: boolean;
  alert_on_exit: boolean;
}

/** Which zone contains this position (geo polygons first, then plan polygons). */
function resolveZone(
  zones: Zone[],
  lat: number | null,
  lng: number | null,
  x: number | null,
  y: number | null
): Zone | null {
  for (const z of zones) {
    const poly = Array.isArray(z.polygon) ? (z.polygon as [number, number][]) : [];
    if (poly.length < 3) continue;
    if (z.coord_mode === "geo" && lat !== null && lng !== null) {
      if (pointInPolygon([lat, lng], poly)) return z;
    } else if (z.coord_mode === "plan" && x !== null && y !== null) {
      if (pointInPolygon([x, y], poly)) return z;
    }
  }
  return null;
}

/** Skip an alert kind that is already open/being handled for this person. */
async function alreadyOpen(
  tx: Tx,
  memberId: string,
  kind: string
): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hrc_alerts
    WHERE member_id = ${memberId} AND kind = ${kind}
      AND status IN ('open','ack','dispatched')
      AND created_at > now() - interval '30 minutes'
  `;
  return (row?.n ?? 0) > 0;
}

export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const [company] = await sql<
    { schema_name: string; status: string; modules: string[] | null }[]
  >`
    SELECT schema_name, status, modules FROM platform.companies
    WHERE slug = ${params.slug}
  `;
  if (!company || company.status === "suspended") {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }
  if (!hasModule(normalizeModules(company.modules), "hrc")) {
    return NextResponse.json(
      { error: "hrc panel is not enabled for this company" },
      { status: 403 }
    );
  }

  const auth = req.headers.get("authorization") || "";
  const token =
    auth.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-device-token")?.trim() ||
    "";
  if (!token) {
    return NextResponse.json({ error: "missing device token" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const batch: Body[] = Array.isArray(body.readings)
    ? (body.readings as Body[])
    : [body];
  if (batch.length === 0 || batch.length > 200) {
    return NextResponse.json({ error: "readings must be 1..200" }, { status: 400 });
  }

  return withTenant(company.schema_name, async (tx) => {
    const [device] = await tx<
      { id: string; member_id: string | null; is_active: boolean }[]
    >`
      SELECT id, member_id, is_active FROM hrc_devices WHERE token = ${token}
    `;
    if (!device || !device.is_active) {
      return NextResponse.json({ error: "invalid device token" }, { status: 401 });
    }

    const [t] = await tx<Thresholds[]>`SELECT * FROM hrc_thresholds WHERE id = 1`;
    const thresholds: Thresholds = t ?? DEFAULT_THRESHOLDS;
    const zones = await tx<Zone[]>`
      SELECT id, name, coord_mode, polygon, alert_on_enter, alert_on_exit
      FROM hrc_zones
    `;

    let stored = 0;
    let raised = 0;
    let lastBattery: number | null = null;

    for (const r of batch) {
      const memberId = str(r.member_id) ?? device.member_id;
      if (!memberId) continue; // an unassigned device has nobody to report for

      const [member] = await tx<{ id: string }[]>`
        SELECT id FROM members WHERE id = ${memberId}
      `;
      if (!member) continue;

      const at = str(r.at) ? new Date(String(r.at)) : new Date();
      if (Number.isNaN(at.getTime())) continue;

      const lat = num(r.lat);
      const lng = num(r.lng);
      const x = num(r.x);
      const y = num(r.y);
      const battery = num(r.battery);
      lastBattery = battery ?? lastBattery;
      const source = SOURCES.includes(String(r.source)) ? String(r.source) : "gps";
      const zone = resolveZone(zones, lat, lng, x, y);

      const reading = {
        heart_rate: num(r.heart_rate),
        spo2: num(r.spo2),
        body_temp: num(r.body_temp),
        battery,
        motion: str(r.motion),
        sos: r.sos === true,
      };

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO hrc_readings
          (member_id, device_id, recorded_at, heart_rate, spo2, body_temp, steps,
           stress, battery, motion, lat, lng, accuracy, altitude, x, y, source,
           zone_id, raw)
        VALUES (
          ${memberId}, ${device.id}, ${at.toISOString()},
          ${reading.heart_rate}, ${reading.spo2}, ${reading.body_temp},
          ${num(r.steps)}, ${num(r.stress)}, ${battery}, ${reading.motion},
          ${lat}, ${lng}, ${num(r.accuracy)}, ${num(r.altitude)}, ${x}, ${y},
          ${source}, ${zone?.id ?? null}, ${tx.json(r as never)}
        )
        RETURNING id
      `;
      stored++;

      const detected: DetectedAlert[] = evaluateReading(reading, thresholds);

      // Geofence: entering a zone marked alert_on_enter (e.g. ناحیهٔ ممنوعه).
      if (thresholds.geofence_alert && zone?.alert_on_enter) {
        detected.push({
          kind: "geofence",
          severity: "warn",
          message: `ورود به «${zone.name}» ثبت شد.`,
        });
      }
      // …or leaving a zone the person was inside on the previous reading.
      if (thresholds.geofence_alert && !zone) {
        const [prev] = await tx<{ zone_id: string | null }[]>`
          SELECT zone_id FROM hrc_readings
          WHERE member_id = ${memberId} AND id <> ${row.id}
          ORDER BY recorded_at DESC LIMIT 1
        `;
        if (prev?.zone_id) {
          const left = zones.find((z) => z.id === prev.zone_id);
          if (left?.alert_on_exit) {
            detected.push({
              kind: "geofence",
              severity: "warn",
              message: `خروج از «${left.name}» ثبت شد.`,
            });
          }
        }
      }

      for (const a of detected) {
        if (await alreadyOpen(tx, memberId, a.kind)) continue;
        const [alert] = await tx<{ id: string }[]>`
          INSERT INTO hrc_alerts
            (member_id, device_id, reading_id, kind, severity, message, lat, lng, zone_id)
          VALUES (${memberId}, ${device.id}, ${row.id}, ${a.kind}, ${a.severity},
                  ${a.message}, ${lat}, ${lng}, ${zone?.id ?? null})
          RETURNING id
        `;
        raised++;

        // Critical events may dispatch the standby team without waiting for a
        // human, when the company switched that on.
        if (
          thresholds.auto_dispatch &&
          a.severity === "critical" &&
          thresholds.auto_dispatch_team
        ) {
          await tx`
            INSERT INTO hrc_dispatches
              (alert_id, team_id, target_member_id, priority, lat, lng, zone_id, note)
            VALUES (${alert.id}, ${thresholds.auto_dispatch_team}, ${memberId},
                    'critical', ${lat}, ${lng}, ${zone?.id ?? null},
                    'اعزام خودکار بر اساس قوانین HRC')
          `;
          await tx`UPDATE hrc_alerts SET status = 'dispatched' WHERE id = ${alert.id}`;
        }
      }
    }

    await tx`
      UPDATE hrc_devices
      SET last_seen = now(), battery = COALESCE(${lastBattery}, battery)
      WHERE id = ${device.id}
    `;

    return NextResponse.json({ ok: true, stored, alerts: raised });
  });
}
