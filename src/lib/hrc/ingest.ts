import "server-only";
import type { TransactionSql } from "postgres";
import { withTenant } from "@/lib/db";
import type { z } from "zod";
import type {
  LocationFix,
  HealthReading,
  DeviceEvent,
  HeartbeatRequest,
} from "./schemas";
import {
  evaluateRules,
  sourceCategory,
  clampSeverity,
  defaultSeverity,
  opensIncident,
  type RuleRow,
  type Facts,
} from "./rules";
import {
  loadPolicy,
  loadZones,
  zoneAt,
  planZoneAt,
  gateLocation,
  alwaysAllowed,
  type ZoneRow,
  type SiteBounds,
} from "./privacy";
import type { DeviceContext } from "./device-auth";

/**
 * خط لولهٔ دریافت تله‌متری.
 *
 * Everything a device sends lands here. Three properties matter and are
 * enforced rather than hoped for:
 *
 *  1. **Idempotent.** A phone that was offline retries its queue; the same
 *     `clientEventId` must never produce two events, or the command centre
 *     sees phantom emergencies.
 *  2. **Partially successful.** One malformed fix in a batch of 200 must not
 *     throw away the other 199 — each item gets its own result.
 *  3. **Honest.** Non-GPS fixes are stored as ESTIMATED with a confidence,
 *     never as if they were satellite-accurate.
 */

const ESTIMATED_SOURCES = new Set(["NETWORK", "WIFI", "CELL", "BLE_BEACON", "MANUAL"]);
const DEFAULT_CONFIDENCE: Record<string, number> = {
  GPS: 0.9,
  UWB: 0.85,
  BLE_BEACON: 0.7,
  WIFI: 0.6,
  WEARABLE: 0.5,
  NETWORK: 0.45,
  MANUAL: 0.4,
  CELL: 0.3,
};

/** The server decides quality — a client cannot call a Cell fix ACTUAL. */
function qualityOf(source: string): "ACTUAL" | "ESTIMATED" {
  return ESTIMATED_SOURCES.has(source) ? "ESTIMATED" : "ACTUAL";
}

function confidenceOf(source: string, claimed?: number | null): number {
  const ceiling = DEFAULT_CONFIDENCE[source] ?? 0.5;
  if (claimed == null || !Number.isFinite(claimed)) return ceiling;
  return Math.min(Math.max(claimed, 0), ceiling);
}

export interface ItemResult {
  index: number;
  status: "stored" | "duplicate" | "skipped" | "rejected";
  id?: string;
  reason?: string;
}

interface Context {
  tx: TransactionSql;
  ctx: DeviceContext;
  zones: ZoneRow[];
  site: SiteBounds;
  thresholds: Record<string, unknown>;
  rules: RuleRow[];
}

async function loadContext(tx: TransactionSql, ctx: DeviceContext): Promise<Context> {
  const [zones, siteRow, thrRow, rules] = await Promise.all([
    loadZones(tx),
    tx<SiteBounds[]>`SELECT north, south, east, west FROM hrc_map WHERE id = 1`,
    tx<Record<string, unknown>[]>`SELECT * FROM hrc_thresholds WHERE id = 1`,
    tx<RuleRow[]>`
      SELECT id, code, name, enabled, priority, severity, conditions, actions
      FROM hrc_rules WHERE enabled = true ORDER BY priority
    `,
  ]);
  return {
    tx,
    ctx,
    zones,
    site: siteRow[0] ?? { north: null, south: null, east: null, west: null },
    thresholds: thrRow[0] ?? {},
    rules,
  };
}

/* ────────────────────────────────── events ───────────────────────────────── */

interface RaiseInput {
  eventType: string;
  severity?: string;
  message?: string | null;
  clientEventId?: string | null;
  occurredAt?: Date | string | null;
  confidence?: number | null;
  detectorVersion?: string | null;
  locationId?: string | null;
  zoneId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Create one event, open an incident if it is serious enough, and record the
 * opening transition. Returns null when the event was a duplicate retry.
 */
export async function raiseEvent(
  tx: TransactionSql,
  ctx: { memberId: string; deviceId: string | null },
  input: RaiseInput
): Promise<{ id: string; incidentId: string | null } | null> {
  const severity = clampSeverity(input.eventType, input.severity);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

  const [ev] = await tx<{ id: string }[]>`
    INSERT INTO hrc_events
      (client_event_id, event_type, severity, status, source_category, member_id,
       device_id, location_id, zone_id, occurred_at, received_at, confidence,
       detector_version, message, payload)
    VALUES
      (${input.clientEventId ?? null}, ${input.eventType}, ${severity}, 'CREATED',
       ${sourceCategory(input.eventType)}, ${ctx.memberId}, ${ctx.deviceId},
       ${input.locationId ?? null}, ${input.zoneId ?? null}, ${occurredAt}, now(),
       ${input.confidence ?? null}, ${input.detectorVersion ?? null},
       ${input.message ?? null}, ${tx.json((input.payload ?? {}) as never)})
    ON CONFLICT (device_id, client_event_id)
      WHERE client_event_id IS NOT NULL AND device_id IS NOT NULL
      DO NOTHING
    RETURNING id
  `;
  if (!ev) return null; // the device retried a delivery we already have

  await tx`
    INSERT INTO hrc_event_transitions (event_id, from_status, to_status, note)
    VALUES (${ev.id}, NULL, 'CREATED', 'ثبت خودکار از دستگاه')
  `;

  let incidentId: string | null = null;
  if (opensIncident(severity)) {
    const [inc] = await tx<{ id: string }[]>`
      INSERT INTO hrc_incidents
        (incident_no, member_id, primary_event_id, severity, status, title, opened_at)
      VALUES
        (COALESCE((SELECT max(incident_no) FROM hrc_incidents), 0) + 1,
         ${ctx.memberId}, ${ev.id}, ${severity}, 'OPEN',
         ${input.message ?? input.eventType}, ${occurredAt})
      RETURNING id
    `;
    incidentId = inc.id;
    await tx`UPDATE hrc_events SET incident_id = ${incidentId} WHERE id = ${ev.id}`;
  }
  return { id: ev.id, incidentId };
}

/**
 * Suppress a repeat of the *same rule* for the same person while an earlier
 * one is still open. Without this a heart-rate rule fires on every reading and
 * buries the operator; v1 used a 30-minute window and that is kept here.
 *
 * Keyed on the rule, not the event type, and that distinction matters: every
 * vitals rule raises `ABNORMAL_SENSOR_READING`, so keying on the event type
 * would let a high heart rate silence a collapsing SpO2 for half an hour.
 * Different problems must always be able to speak.
 */
async function recentlyRaised(
  tx: TransactionSql,
  memberId: string,
  eventType: string,
  ruleCode: string | null,
  minutes = 30
): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`
    SELECT id FROM hrc_events
    WHERE member_id = ${memberId}
      AND event_type = ${eventType}
      AND status IN ('CREATED','ACKNOWLEDGED','INVESTIGATING')
      AND occurred_at > now() - make_interval(mins => ${minutes})
      AND ${
        ruleCode
          ? tx`payload->>'rule' = ${ruleCode}`
          : tx`payload->>'rule' IS NULL`
      }
    LIMIT 1
  `;
  return Boolean(row);
}

/* ───────────────────────────────── locations ─────────────────────────────── */

export async function ingestLocations(
  ctx: DeviceContext,
  fixes: z.infer<typeof LocationFix>[]
): Promise<{ results: ItemResult[]; events: number }> {
  return withTenant(ctx.schema, async (tx) => {
    const c = await loadContext(tx, ctx);
    const policy = await loadPolicy(tx);
    const results: ItemResult[] = [];
    let events = 0;

    // Where the person was before this batch — the geofence transition needs it.
    const [prev] = await tx<{ zone_id: string | null }[]>`
      SELECT zone_id FROM hrc_last_position WHERE member_id = ${ctx.memberId}
    `;
    let previousZone = prev?.zone_id ?? null;
    let newest: { id: string; recordedAt: Date } | null = null;

    for (let i = 0; i < fixes.length; i++) {
      const f = fixes[i];
      const hasGeo = f.latitude != null && f.longitude != null;
      const hasPlan = f.planX != null && f.planY != null;
      if (!hasGeo && !hasPlan) {
        results.push({ index: i, status: "rejected", reason: "no_position" });
        continue;
      }

      const zone = hasGeo
        ? zoneAt(c.zones, f.latitude!, f.longitude!)
        : planZoneAt(c.zones, f.planX!, f.planY!);

      const gate = await gateLocation(tx, policy, {
        memberId: ctx.memberId,
        lat: f.latitude,
        lng: f.longitude,
        zone,
        site: c.site,
      });
      if (!gate.allowed) {
        results.push({ index: i, status: "skipped", reason: gate.reason });
        continue;
      }

      const recordedAt = new Date(f.recordedAt);
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO hrc_locations
          (member_id, device_id, recorded_at, received_at, latitude, longitude,
           accuracy_m, altitude, source, quality, confidence, zone_id, plan_x, plan_y)
        VALUES
          (${ctx.memberId}, ${ctx.deviceId}, ${recordedAt}, now(), ${f.latitude ?? null},
           ${f.longitude ?? null}, ${f.accuracyM ?? null}, ${f.altitude ?? null},
           ${f.source}, ${qualityOf(f.source)}, ${confidenceOf(f.source, f.confidence)},
           ${zone?.id ?? null}, ${f.planX ?? null}, ${f.planY ?? null})
        RETURNING id
      `;
      results.push({ index: i, status: "stored", id: row.id });
      if (!newest || recordedAt > newest.recordedAt) {
        newest = { id: row.id, recordedAt };
      }

      /* geofence transitions — only on a real change of zone */
      if (zone?.id !== previousZone) {
        const left = c.zones.find((z) => z.id === previousZone);
        if (left?.alert_on_exit) {
          const r = await raiseEvent(tx, ctx, {
            eventType: "GEOFENCE_EXIT",
            message: `خروج از ناحیهٔ ${left.name}`,
            occurredAt: recordedAt,
            locationId: row.id,
            zoneId: left.id,
            payload: { zone: left.name, zoneType: left.zone_type },
          });
          if (r) events++;
        }
        if (zone?.alert_on_enter) {
          const high = zone.zone_type === "HIGH_RISK_ZONE" || zone.zone_type === "NO_ACCESS_ZONE";
          const r = await raiseEvent(tx, ctx, {
            eventType: high ? "HIGH_RISK_ZONE_ENTERED" : "GEOFENCE_ENTER",
            message: `ورود به ناحیهٔ ${zone.name}`,
            occurredAt: recordedAt,
            locationId: row.id,
            zoneId: zone.id,
            payload: { zone: zone.name, zoneType: zone.zone_type },
          });
          if (r) events++;
        }
        previousZone = zone?.id ?? null;
      }
    }

    if (newest) await refreshLastPosition(tx, ctx.memberId, newest.id);
    return { results, events };
  });
}

/**
 * Point the live-map row at a stored fix — but only if it really is newer.
 * A late-arriving batch from a phone that was offline must not drag someone's
 * marker back to where they were an hour ago.
 */
async function refreshLastPosition(
  tx: TransactionSql,
  memberId: string,
  locationId: string
): Promise<void> {
  await tx`
    INSERT INTO hrc_last_position
      (member_id, location_id, device_id, recorded_at, latitude, longitude,
       accuracy_m, source, quality, confidence, zone_id, plan_x, plan_y, updated_at)
    SELECT l.member_id, l.id, l.device_id, l.recorded_at, l.latitude, l.longitude,
           l.accuracy_m, l.source, l.quality, l.confidence, l.zone_id,
           l.plan_x, l.plan_y, now()
    FROM hrc_locations l WHERE l.id = ${locationId} AND l.member_id = ${memberId}
    ON CONFLICT (member_id) DO UPDATE SET
      location_id = EXCLUDED.location_id, device_id = EXCLUDED.device_id,
      recorded_at = EXCLUDED.recorded_at, latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude, accuracy_m = EXCLUDED.accuracy_m,
      source = EXCLUDED.source, quality = EXCLUDED.quality,
      confidence = EXCLUDED.confidence, zone_id = EXCLUDED.zone_id,
      plan_x = EXCLUDED.plan_x, plan_y = EXCLUDED.plan_y, updated_at = now()
    WHERE hrc_last_position.recorded_at IS NULL
       OR EXCLUDED.recorded_at > hrc_last_position.recorded_at
  `;
}

/* ────────────────────────────── health readings ──────────────────────────── */

export async function ingestHealth(
  ctx: DeviceContext,
  readings: z.infer<typeof HealthReading>[]
): Promise<{ results: ItemResult[]; events: number }> {
  return withTenant(ctx.schema, async (tx) => {
    const c = await loadContext(tx, ctx);
    const results: ItemResult[] = [];
    let events = 0;

    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      const anySensor =
        r.heartRate != null || r.spo2 != null || r.skinTemp != null || r.steps != null;

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO hrc_health_readings
          (member_id, device_id, recorded_at, heart_rate, hrv, spo2, skin_temp,
           steps, stress, activity_state, classification)
        VALUES
          (${ctx.memberId}, ${ctx.deviceId}, ${new Date(r.recordedAt)},
           ${r.heartRate ?? null}, ${r.hrv ?? null}, ${r.spo2 ?? null},
           ${r.skinTemp ?? null}, ${r.steps ?? null}, ${r.stress ?? null},
           ${r.activityState ?? null},
           ${anySensor ? "NORMAL" : "SENSOR_UNAVAILABLE"})
        RETURNING id
      `;
      results.push({ index: i, status: "stored", id: row.id });
      if (!anySensor) continue;

      const facts: Facts = {
        heart_rate: r.heartRate ?? null,
        spo2: r.spo2 ?? null,
        skin_temp: r.skinTemp ?? null,
        stress: r.stress ?? null,
        motion: r.activityState ?? null,
      };
      for (const m of evaluateRules(c.rules, facts, c.thresholds)) {
        if (await recentlyRaised(tx, ctx.memberId, m.eventType, m.code)) continue;
        const created = await raiseEvent(tx, ctx, {
          eventType: m.eventType,
          severity: m.severity,
          message: m.message,
          occurredAt: r.recordedAt,
          payload: { rule: m.code, metric: m.metric, matched: m.matched },
        });
        if (created) {
          events++;
          // the reading that tripped it is no longer «NORMAL»
          await tx`
            UPDATE hrc_health_readings SET classification = 'ABNORMAL_READING'
            WHERE id = ${row.id}
          `;
        }
      }
    }
    return { results, events };
  });
}

/* ──────────────────────────────── heartbeats ─────────────────────────────── */

export async function ingestHeartbeat(
  ctx: DeviceContext,
  hb: z.infer<typeof HeartbeatRequest>
): Promise<{ id: string; events: number }> {
  return withTenant(ctx.schema, async (tx) => {
    const c = await loadContext(tx, ctx);
    const recordedAt = hb.recordedAt ? new Date(hb.recordedAt) : new Date();

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO hrc_heartbeats
        (device_id, member_id, recorded_at, battery, charging, network,
         gps_enabled, app_state, watch_connected, permissions)
      VALUES
        (${ctx.deviceId}, ${ctx.memberId}, ${recordedAt}, ${hb.battery ?? null},
         ${hb.charging ?? null}, ${hb.network ?? null}, ${hb.gpsEnabled ?? null},
         ${hb.appState ?? null}, ${hb.watchConnected ?? null},
         ${tx.json(hb.permissions as never)})
      RETURNING id
    `;
    await tx`
      UPDATE hrc_devices
      SET last_heartbeat_at = ${recordedAt},
          battery = COALESCE(${hb.battery ?? null}, battery),
          network = COALESCE(${hb.network ?? null}, network),
          last_seen = ${recordedAt}
      WHERE id = ${ctx.deviceId}
    `;

    let events = 0;
    const facts: Facts = {
      battery: hb.battery ?? null,
      charging: hb.charging ?? null,
      gps_enabled: hb.gpsEnabled ?? null,
      watch_connected: hb.watchConnected ?? null,
    };
    for (const m of evaluateRules(c.rules, facts, c.thresholds)) {
      if (await recentlyRaised(tx, ctx.memberId, m.eventType, m.code, 120)) continue;
      const created = await raiseEvent(tx, ctx, {
        eventType: m.eventType,
        severity: m.severity,
        message: m.message,
        occurredAt: recordedAt,
        payload: { rule: m.code, matched: m.matched },
      });
      if (created) events++;
    }

    // A charging device is not "low battery" — but a watch that lost its
    // phone, or an app denied location, is a real gap in coverage. These two
    // are not rule-driven, so they need the same suppression by hand:
    // a heartbeat every five minutes must not mean an alert every five minutes.
    if (hb.gpsEnabled === false && !(await recentlyRaised(tx, ctx.memberId, "LOCATION_DISABLED", null, 120))) {
      const created = await raiseEvent(tx, ctx, {
        eventType: "LOCATION_DISABLED",
        occurredAt: recordedAt,
        message: "موقعیت‌یابی روی دستگاه خاموش است",
        payload: {},
      });
      if (created) events++;
    }
    if (
      hb.watchConnected === false &&
      ctx.deviceType === "ANDROID_PHONE" &&
      !(await recentlyRaised(tx, ctx.memberId, "WATCH_DISCONNECTED", null, 120))
    ) {
      const created = await raiseEvent(tx, ctx, {
        eventType: "WATCH_DISCONNECTED",
        occurredAt: recordedAt,
        message: "ارتباط ساعت با گوشی قطع است",
        payload: {},
      });
      if (created) events++;
    }
    return { id: row.id, events };
  });
}

/* ─────────────────────────────── device events ───────────────────────────── */

export async function ingestEvents(
  ctx: DeviceContext,
  events: z.infer<typeof DeviceEvent>[]
): Promise<{ results: ItemResult[] }> {
  return withTenant(ctx.schema, async (tx) => {
    const c = await loadContext(tx, ctx);
    const policy = await loadPolicy(tx);
    const results: ItemResult[] = [];

    // SOS and falls first: a batch must not make an emergency wait behind
    // twelve battery warnings.
    const order = events
      .map((e, index) => ({ e, index }))
      .sort((a, b) => rank(b.e.eventType) - rank(a.e.eventType));

    for (const { e, index } of order) {
      // Check for the retry *before* writing anything. A phone re-sending its
      // queue must not leave a trail of orphan location rows behind every
      // event we then refuse as a duplicate.
      const [seen] = await tx<{ id: string }[]>`
        SELECT id FROM hrc_events
        WHERE device_id = ${ctx.deviceId} AND client_event_id = ${e.clientEventId}
      `;
      if (seen) {
        results.push({ index, status: "duplicate", reason: "client_event_id_seen" });
        continue;
      }

      let locationId: string | null = null;
      let zoneId: string | null = null;

      if (e.latitude != null && e.longitude != null) {
        const zone = zoneAt(c.zones, e.latitude, e.longitude);
        zoneId = zone?.id ?? null;
        const gate = alwaysAllowed(e.eventType)
          ? { allowed: true as const }
          : await gateLocation(tx, policy, {
              memberId: ctx.memberId,
              lat: e.latitude,
              lng: e.longitude,
              zone,
              site: c.site,
            });
        if (gate.allowed) {
          const [loc] = await tx<{ id: string }[]>`
            INSERT INTO hrc_locations
              (member_id, device_id, recorded_at, latitude, longitude, accuracy_m,
               source, quality, confidence, zone_id)
            VALUES (${ctx.memberId}, ${ctx.deviceId}, ${new Date(e.occurredAt)},
                    ${e.latitude}, ${e.longitude}, ${e.accuracyM ?? null},
                    'GPS', 'ACTUAL', ${DEFAULT_CONFIDENCE.GPS}, ${zoneId})
            RETURNING id
          `;
          locationId = loc.id;
          await refreshLastPosition(tx, ctx.memberId, loc.id);
        }
      }

      const created = await raiseEvent(tx, ctx, {
        eventType: e.eventType,
        severity: e.severity ?? defaultSeverity(e.eventType),
        message: e.message ?? null,
        clientEventId: e.clientEventId,
        occurredAt: e.occurredAt,
        confidence: e.confidence,
        detectorVersion: e.detectorVersion ?? null,
        locationId,
        zoneId,
        payload: e.payload,
      });
      // The unique index is still the authority — two concurrent uploads of
      // the same queue race past the check above and only one wins.
      results.push(
        created
          ? { index, status: "stored", id: created.id }
          : { index, status: "duplicate", reason: "client_event_id_seen" }
      );
    }
    results.sort((a, b) => a.index - b.index);
    return { results };
  });
}

function rank(eventType: string): number {
  if (eventType === "SOS") return 3;
  if (eventType === "FALL_DETECTED") return 2;
  return sourceCategory(eventType) === "EMPLOYEE" ? 1 : 0;
}
