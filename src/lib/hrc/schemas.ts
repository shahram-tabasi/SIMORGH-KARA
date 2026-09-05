import { z } from "zod";

/**
 * اعتبارسنجی همهٔ ورودی‌های HRC نسخهٔ ۲.
 *
 * Every boundary — device traffic and operator traffic alike — parses through
 * one of these. Nothing reaches SQL unvalidated.
 */

export const DEVICE_TYPES = [
  "ANDROID_PHONE",
  "WEAR_OS_WATCH",
  "DEDICATED_WEARABLE",
  "BLE_TAG",
  "NFC_DEVICE",
  "FUTURE_IOT_DEVICE",
] as const;

export const LOCATION_SOURCES = [
  "GPS",
  "NETWORK",
  "WIFI",
  "CELL",
  "BLE_BEACON",
  "UWB",
  "MANUAL",
  "WEARABLE",
] as const;

export const EVENT_TYPES = [
  "SOS",
  "FALL_DETECTED",
  "INACTIVITY_WARNING",
  "GEOFENCE_ENTER",
  "GEOFENCE_EXIT",
  "HIGH_RISK_ZONE_ENTERED",
  "DEVICE_OFFLINE",
  "LOW_BATTERY",
  "LOCATION_DISABLED",
  "ABNORMAL_SENSOR_READING",
  "WATCH_DISCONNECTED",
  "APP_PERMISSION_ERROR",
  "NO_NETWORK",
  "MANUAL",
] as const;

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const EVENT_STATUSES = [
  "CREATED",
  "ACKNOWLEDGED",
  "INVESTIGATING",
  "RESOLVED",
  "CLOSED",
] as const;
export const INCIDENT_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "INVESTIGATING",
  "RESOLVED",
  "CLOSED",
] as const;
export const ZONE_TYPES = [
  "SAFE_ZONE",
  "RESTRICTED_ZONE",
  "HIGH_RISK_ZONE",
  "EMERGENCY_ZONE",
  "NO_ACCESS_ZONE",
] as const;

/** Batch endpoints are capped so one device cannot flood the pipeline. */
export const MAX_BATCH = 200;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .describe("ISO-8601 timestamp");

/* ─────────────────────────────── device auth ─────────────────────────────── */

export const TicketRequest = z.object({
  slug: z.string().min(1).max(60),
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const EnrollRequest = z.object({
  ticket: z.string().min(8).max(200),
  device: z.object({
    deviceUid: z.string().min(4).max(200),
    deviceType: z.enum(DEVICE_TYPES),
    manufacturer: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    osVersion: z.string().max(60).optional(),
    appVersion: z.string().max(60).optional(),
    // base64 SPKI DER — the *public* half of an Android Keystore key
    publicKey: z.string().min(40).max(4000),
    keyAlgorithm: z.enum(["EC_P256", "ED25519"]).default("EC_P256"),
    capabilities: z.record(z.unknown()).default({}),
    gatewayDeviceUid: z.string().max(200).optional(),
    network: z.string().max(40).optional(),
  }),
});

export const ChallengeRequest = z.object({
  slug: z.string().min(1).max(60),
  deviceUid: z.string().min(4).max(200),
});

export const RefreshRequest = z.object({
  slug: z.string().min(1).max(60),
  deviceUid: z.string().min(4).max(200),
  nonce: z.string().min(8).max(200),
  signature: z.string().min(8).max(2000),
});

/* ──────────────────────────────── telemetry ──────────────────────────────── */

export const HeartbeatRequest = z.object({
  recordedAt: isoDate.optional(),
  battery: z.number().int().min(0).max(100).nullish(),
  charging: z.boolean().nullish(),
  network: z.string().max(40).nullish(),
  gpsEnabled: z.boolean().nullish(),
  appState: z.string().max(40).nullish(),
  watchConnected: z.boolean().nullish(),
  permissions: z.record(z.unknown()).default({}),
});

export const LocationFix = z.object({
  recordedAt: isoDate,
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  altitude: z.number().nullish(),
  source: z.enum(LOCATION_SOURCES).default("GPS"),
  // The device may declare its own confidence; the server clamps it and
  // decides `quality` itself — a client cannot claim a Cell fix is ACTUAL.
  confidence: z.number().min(0).max(1).nullish(),
  planX: z.number().nullish(),
  planY: z.number().nullish(),
});

export const LocationBatch = z.object({
  fixes: z.array(LocationFix).min(1).max(MAX_BATCH),
});

export const HealthReading = z.object({
  recordedAt: isoDate,
  heartRate: z.number().int().min(0).max(400).nullish(),
  hrv: z.number().int().min(0).max(1000).nullish(),
  spo2: z.number().int().min(0).max(100).nullish(),
  skinTemp: z.number().min(20).max(50).nullish(),
  steps: z.number().int().min(0).max(1_000_000).nullish(),
  stress: z.number().int().min(0).max(100).nullish(),
  activityState: z.enum(["still", "walking", "running", "fall", "unknown"]).nullish(),
});

export const HealthBatch = z.object({
  readings: z.array(HealthReading).min(1).max(MAX_BATCH),
});

export const DeviceEvent = z.object({
  clientEventId: z.string().min(1).max(120),
  eventType: z.enum(EVENT_TYPES),
  occurredAt: isoDate,
  severity: z.enum(SEVERITIES).optional(),
  message: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).nullish(),
  detectorVersion: z.string().max(60).optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  payload: z.record(z.unknown()).default({}),
});

export const EventBatch = z.object({
  events: z.array(DeviceEvent).min(1).max(MAX_BATCH),
});

export const SosRequest = z.object({
  clientEventId: z.string().min(1).max(120),
  occurredAt: isoDate.optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  message: z.string().max(500).optional(),
  payload: z.record(z.unknown()).default({}),
});

/* ──────────────────────────────── operator ───────────────────────────────── */

export const IncidentPatch = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  resolutionNote: z.string().max(2000).optional(),
});

export const ResponderCreate = z.object({
  teamId: z.string().uuid().nullish(),
  responderMemberId: z.string().uuid().nullish(),
  role: z.string().max(80).optional(),
  priority: z.enum(["NORMAL", "HIGH", "CRITICAL"]).default("HIGH"),
  note: z.string().max(1000).optional(),
});

export const ResponderPatch = z.object({
  status: z.enum(["ASSIGNED", "ENROUTE", "ONSITE", "DONE", "CANCELLED"]),
  outcome: z.string().max(1000).optional(),
});

const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const ZoneUpsert = z.object({
  name: z.string().min(1).max(120),
  zoneType: z.enum(ZONE_TYPES).default("SAFE_ZONE"),
  shape: z.enum(["CIRCLE", "POLYGON"]).default("POLYGON"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#38bdf8"),
  polygon: z.array(latLng).max(500).default([]),
  centerLat: z.number().min(-90).max(90).nullish(),
  centerLng: z.number().min(-180).max(180).nullish(),
  radiusM: z.number().min(1).max(100_000).nullish(),
  building: z.string().max(120).nullish(),
  floor: z.string().max(60).nullish(),
  alertOnEnter: z.boolean().default(false),
  alertOnExit: z.boolean().default(false),
  isActive: z.boolean().default(true),
  note: z.string().max(1000).nullish(),
}).refine(
  (z_) =>
    z_.shape === "POLYGON"
      ? z_.polygon.length >= 3
      : z_.centerLat != null && z_.centerLng != null && z_.radiusM != null,
  { message: "ناحیهٔ چندضلعی حداقل ۳ نقطه و ناحیهٔ دایره‌ای مرکز و شعاع لازم دارد" }
);

export const RuleUpsert = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10_000).default(100),
  severity: z.enum(SEVERITIES).default("MEDIUM"),
  conditions: z.object({
    all: z
      .array(
        z.object({
          fact: z.string().min(1).max(60),
          op: z.enum([">", ">=", "<", "<=", "=", "!=", "in"]),
          // a literal, or a pointer into the company's own thresholds
          value: z.union([
            z.number(),
            z.string(),
            z.boolean(),
            z.array(z.union([z.number(), z.string()])),
            z.object({ threshold: z.string().min(1).max(60) }),
          ]),
        })
      )
      .min(1)
      .max(20),
  }),
  actions: z.object({
    event: z.enum(EVENT_TYPES),
    message: z.string().max(500).optional(),
    metric: z.string().max(60).optional(),
    confirmSeconds: z.number().int().min(0).max(3600).optional(),
  }),
});

export const PolicyPatch = z.object({
  monitoringMode: z.enum(["SHIFT_ONLY", "FACILITY_ONLY", "ALWAYS"]).optional(),
  retentionLocationDays: z.number().int().min(1).max(3650).optional(),
  retentionEventDays: z.number().int().min(1).max(3650).optional(),
  retentionHeartbeatDays: z.number().int().min(1).max(3650).optional(),
  retentionHealthDays: z.number().int().min(1).max(3650).optional(),
  consentRequired: z.boolean().optional(),
});

export const DevicePatch = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "RETIRED"]).optional(),
  memberId: z.string().uuid().nullish(),
  note: z.string().max(1000).nullish(),
  /** bump token_version — every token issued to this device stops working */
  revokeTokens: z.boolean().optional(),
});
