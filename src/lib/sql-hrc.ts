/**
 * HRC نسخهٔ ۲ — اسکیمای پلتفرم ایمنی دستگاه‌ناوابسته (فاز ۲).
 *
 * Design rules for this migration, all deliberate:
 *
 *  1. **Nothing is dropped or renamed.** The v1 tables (`hrc_devices`,
 *     `hrc_readings`, `hrc_alerts`, `hrc_dispatches`) keep working and stay the
 *     source of truth until Phase 3 moves the writers over. This file only adds
 *     tables and columns, so deploying it changes no behaviour.
 *  2. **Idempotent.** Same text builds a fresh tenant schema and upgrades an
 *     existing one; running it twice is a no-op.
 *  3. **Backfillable.** Every table that mirrors v1 data carries a `legacy_*_id`
 *     column with a unique index, so `HRC_V2_BACKFILL` can be re-run safely.
 *
 * Applied with `search_path` pointed at the tenant schema inside a transaction.
 */
/**
 * ردیف سیاست حریم خصوصی و مجموعهٔ قوانین پیش‌فرض ریسک.
 *
 * Split out of the backfill so a freshly provisioned company gets exactly the
 * same starting rules as a migrated one, without running the v1 data migration
 * against an empty schema.
 */
export const HRC_V2_SEED = /* sql */ `
-- ── one policy row per company ──
INSERT INTO hrc_policies (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── default rule set, generated from the company's existing thresholds ──
INSERT INTO hrc_rules (code, name, description, priority, conditions, actions,
                       severity, is_system)
SELECT * FROM (VALUES
  ('SOS', 'درخواست کمک (SOS)', 'فشردن دکمهٔ کمک روی دستگاه', 10,
   '{"all":[{"fact":"sos","op":"=","value":true}]}'::jsonb,
   '{"event":"SOS","message":"دکمهٔ SOS فشرده شد."}'::jsonb, 'CRITICAL', true),
  ('FALL', 'سقوط / زمین‌خوردن', 'تشخیص سقوط توسط سنسور دستگاه', 20,
   '{"all":[{"fact":"motion","op":"=","value":"fall"}]}'::jsonb,
   '{"event":"FALL_DETECTED","message":"سنسور سقوط را تشخیص داد.","confirmSeconds":60}'::jsonb,
   'CRITICAL', true),
  ('HEART_HIGH', 'ضربان قلب بالا', 'بالاتر از حد مجاز شرکت', 40,
   '{"all":[{"fact":"heart_rate","op":">","value":{"threshold":"hr_max"}}]}'::jsonb,
   '{"event":"ABNORMAL_SENSOR_READING","metric":"heart_rate","message":"ضربان قلب بالاتر از حد مجاز — بررسی دستی توصیه می‌شود."}'::jsonb,
   'HIGH', true),
  ('HEART_LOW', 'ضربان قلب پایین', 'پایین‌تر از حد مجاز شرکت', 41,
   '{"all":[{"fact":"heart_rate","op":"<","value":{"threshold":"hr_min"}}]}'::jsonb,
   '{"event":"ABNORMAL_SENSOR_READING","metric":"heart_rate","message":"ضربان قلب پایین‌تر از حد مجاز — بررسی دستی توصیه می‌شود."}'::jsonb,
   'HIGH', true),
  ('SPO2_LOW', 'افت اکسیژن خون', 'زیر حد مجاز شرکت', 42,
   '{"all":[{"fact":"spo2","op":"<","value":{"threshold":"spo2_min"}}]}'::jsonb,
   '{"event":"ABNORMAL_SENSOR_READING","metric":"spo2","message":"افت اکسیژن خون — بررسی دستی توصیه می‌شود."}'::jsonb,
   'HIGH', true),
  ('TEMP_HIGH', 'دمای بدن بالا', 'بالاتر از حد مجاز شرکت', 43,
   '{"all":[{"fact":"skin_temp","op":">","value":{"threshold":"temp_max"}}]}'::jsonb,
   '{"event":"ABNORMAL_SENSOR_READING","metric":"skin_temp","message":"دمای بدن بالاتر از حد مجاز — بررسی دستی توصیه می‌شود."}'::jsonb,
   'MEDIUM', true),
  ('INACTIVITY', 'بی‌حرکتی طولانی', 'بدون حرکت بیش از حد تعیین‌شده', 50,
   '{"all":[{"fact":"still_minutes","op":">","value":{"threshold":"no_motion_minutes"}}]}'::jsonb,
   '{"event":"INACTIVITY_WARNING","message":"بی‌حرکتی طولانی ثبت شد.","confirmSeconds":120}'::jsonb,
   'MEDIUM', true),
  ('GEOFENCE', 'ورود/خروج ناحیه', 'ورود به ناحیه‌ای که هشدار دارد', 60,
   '{"all":[{"fact":"zone_alert","op":"=","value":true}]}'::jsonb,
   '{"event":"GEOFENCE_ENTER","message":"ورود به ناحیهٔ هشداردار."}'::jsonb,
   'MEDIUM', true),
  ('OFFLINE', 'قطع ارتباط دستگاه', 'نرسیدن ضربان از دستگاه', 70,
   '{"all":[{"fact":"silent_minutes","op":">","value":{"threshold":"offline_minutes"}}]}'::jsonb,
   '{"event":"DEVICE_OFFLINE","message":"ارتباط دستگاه قطع شده است."}'::jsonb,
   'MEDIUM', true),
  ('BATTERY', 'باتری ضعیف', 'باتری زیر حد تعیین‌شده', 80,
   '{"all":[{"fact":"battery","op":"<=","value":{"threshold":"battery_low"}}]}'::jsonb,
   '{"event":"LOW_BATTERY","message":"باتری دستگاه رو به اتمام است."}'::jsonb,
   'INFO', true)
) AS seed(code, name, description, priority, conditions, actions, severity, is_system)
WHERE NOT EXISTS (SELECT 1 FROM hrc_rules r WHERE r.code = seed.code);
`;

export const HRC_V2_DDL = /* sql */ `
-- ════════════════ SafetyDevice — هر دستگاه ایمنی، از هر نوع ════════════════
-- v1 had a single "watch/band/tag/phone/beacon" kind. The platform now has to
-- describe phones, watches, dedicated wearables, BLE tags, NFC devices and
-- future IoT hardware, with capabilities, hardware-bound keys and a gateway
-- link (a watch that reaches the server through its phone).
ALTER TABLE hrc_devices
  ADD COLUMN IF NOT EXISTS device_uid text,
  ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'WEAR_OS_WATCH',
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS os_version text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS public_key text,
  ADD COLUMN IF NOT EXISTS attestation jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS gateway_device_id uuid,
  ADD COLUMN IF NOT EXISTS network text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_simulated boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE hrc_devices ADD CONSTRAINT hrc_devices_type_check
    CHECK (device_type IN ('ANDROID_PHONE','WEAR_OS_WATCH','DEDICATED_WEARABLE',
                           'BLE_TAG','NFC_DEVICE','FUTURE_IOT_DEVICE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE hrc_devices ADD CONSTRAINT hrc_devices_status_check
    CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE hrc_devices ADD CONSTRAINT hrc_devices_gateway_fk
    FOREIGN KEY (gateway_device_id) REFERENCES hrc_devices(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_devices_uid
  ON hrc_devices(device_uid) WHERE device_uid IS NOT NULL;

-- تخصیص دستگاه به فرد — تاریخچه‌دار، نه یک ستون.
-- «دستگاه فعالِ هر نفر» یعنی کم‌ترین اولویتِ باز با ضربان تازه (failover).
CREATE TABLE IF NOT EXISTS hrc_device_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES hrc_devices(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  priority      text NOT NULL DEFAULT 'PRIMARY'
                  CHECK (priority IN ('PRIMARY','SECONDARY','BACKUP')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  assigned_by   uuid REFERENCES members(id) ON DELETE SET NULL,
  note          text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_assignment_open
  ON hrc_device_assignments(device_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hrc_assignment_member
  ON hrc_device_assignments(member_id) WHERE unassigned_at IS NULL;

-- ═══════════════════ LocationRecord — موقعیت با کیفیت صادقانه ═══════════════════
-- quality is the honesty column the specification insists on: a Cell-ID fix is
-- ESTIMATED with a large accuracy_m and a low confidence, and the UI must draw
-- it as an uncertainty circle, never as a precise pin.
CREATE TABLE IF NOT EXISTS hrc_locations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid REFERENCES members(id) ON DELETE CASCADE,
  device_id         uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  received_at       timestamptz NOT NULL DEFAULT now(),
  latitude          double precision,
  longitude         double precision,
  accuracy_m        double precision,
  altitude          double precision,
  source            text NOT NULL DEFAULT 'GPS'
                      CHECK (source IN ('GPS','NETWORK','WIFI','CELL','BLE_BEACON',
                                        'UWB','MANUAL','WEARABLE')),
  quality           text NOT NULL DEFAULT 'ACTUAL'
                      CHECK (quality IN ('ACTUAL','ESTIMATED','LAST_KNOWN')),
  confidence        numeric(4,3),
  zone_id           uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  plan_x            double precision,
  plan_y            double precision,
  is_simulated      boolean NOT NULL DEFAULT false,
  legacy_reading_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_loc_member_time
  ON hrc_locations(member_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_loc_time ON hrc_locations(recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_loc_legacy
  ON hrc_locations(legacy_reading_id) WHERE legacy_reading_id IS NOT NULL;

-- «آخرین موقعیت هر نفر» جدا نگه داشته می‌شود تا نقشهٔ زنده هرگز تاریخچه را
-- اسکن نکند (۵۰۰ نفر × هر ۳۰ ثانیه ≈ ۱.۴ میلیون ردیف در روز).
CREATE TABLE IF NOT EXISTS hrc_last_position (
  member_id   uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  location_id uuid REFERENCES hrc_locations(id) ON DELETE SET NULL,
  device_id   uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  recorded_at timestamptz,
  latitude    double precision,
  longitude   double precision,
  accuracy_m  double precision,
  source      text,
  quality     text,
  confidence  numeric(4,3),
  zone_id     uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  plan_x      double precision,
  plan_y      double precision,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ═════════════ DeviceHeartbeat — سلامت خودِ دستگاه، جدا از سلامت فرد ═════════════
CREATE TABLE IF NOT EXISTS hrc_heartbeats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      uuid NOT NULL REFERENCES hrc_devices(id) ON DELETE CASCADE,
  member_id      uuid REFERENCES members(id) ON DELETE SET NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  battery        int,
  charging       boolean,
  network        text,
  gps_enabled    boolean,
  app_state      text,
  watch_connected boolean,
  permissions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_simulated   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_hrc_heartbeat_device
  ON hrc_heartbeats(device_id, recorded_at DESC);

-- ═══════════ Health readings — محافظه‌کارانه، بدون هیچ تشخیص پزشکی ═══════════
CREATE TABLE IF NOT EXISTS hrc_health_readings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid REFERENCES members(id) ON DELETE CASCADE,
  device_id         uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  heart_rate        int,
  hrv               int,
  spo2              int,
  skin_temp         numeric(4,1),
  steps             int,
  stress            int,
  activity_state    text,
  classification    text NOT NULL DEFAULT 'UNKNOWN'
                      CHECK (classification IN ('NORMAL','ABNORMAL_READING',
                                                'SENSOR_UNAVAILABLE','UNKNOWN')),
  is_simulated      boolean NOT NULL DEFAULT false,
  legacy_reading_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_health_member
  ON hrc_health_readings(member_id, recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_health_legacy
  ON hrc_health_readings(legacy_reading_id) WHERE legacy_reading_id IS NOT NULL;

-- ═══════════════════ SafetyIncident — پروندهٔ رسیدگی ═══════════════════
CREATE TABLE IF NOT EXISTS hrc_incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_no      int,
  member_id        uuid REFERENCES members(id) ON DELETE SET NULL,
  primary_event_id uuid,
  severity         text NOT NULL DEFAULT 'MEDIUM'
                     CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  status           text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING',
                                       'RESOLVED','CLOSED')),
  title            text,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  closed_at        timestamptz,
  resolution_note  text,
  is_simulated     boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_incident_no
  ON hrc_incidents(incident_no) WHERE incident_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hrc_incident_status
  ON hrc_incidents(status, opened_at DESC);

-- ══════════════════════ SafetyEvent — واحد پایهٔ همه‌چیز ══════════════════════
-- source_category is what lets the command centre keep «اورژانس کارمند» and
-- «مشکل فنی دستگاه» in separate lanes, as the specification requires.
CREATE TABLE IF NOT EXISTS hrc_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text,
  event_type      text NOT NULL
                    CHECK (event_type IN ('SOS','FALL_DETECTED','INACTIVITY_WARNING',
                      'GEOFENCE_ENTER','GEOFENCE_EXIT','HIGH_RISK_ZONE_ENTERED',
                      'DEVICE_OFFLINE','LOW_BATTERY','LOCATION_DISABLED',
                      'ABNORMAL_SENSOR_READING','WATCH_DISCONNECTED',
                      'APP_PERMISSION_ERROR','NO_NETWORK','MANUAL')),
  severity        text NOT NULL DEFAULT 'MEDIUM'
                    CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  status          text NOT NULL DEFAULT 'CREATED'
                    CHECK (status IN ('CREATED','ACKNOWLEDGED','INVESTIGATING',
                                      'RESOLVED','CLOSED')),
  source_category text NOT NULL DEFAULT 'EMPLOYEE'
                    CHECK (source_category IN ('EMPLOYEE','DEVICE')),
  member_id       uuid REFERENCES members(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  incident_id     uuid REFERENCES hrc_incidents(id) ON DELETE SET NULL,
  location_id     uuid REFERENCES hrc_locations(id) ON DELETE SET NULL,
  zone_id         uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  -- device clock and server clock are both kept; they disagree in the field
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  received_at     timestamptz NOT NULL DEFAULT now(),
  confidence      numeric(4,3),
  detector_version text,
  message         text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_simulated    boolean NOT NULL DEFAULT false,
  legacy_alert_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_events_status
  ON hrc_events(status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_events_member
  ON hrc_events(member_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_events_incident ON hrc_events(incident_id);
-- offline retries must never duplicate an event
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_events_client
  ON hrc_events(device_id, client_event_id)
  WHERE client_event_id IS NOT NULL AND device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_events_legacy
  ON hrc_events(legacy_alert_id) WHERE legacy_alert_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE hrc_incidents ADD CONSTRAINT hrc_incidents_primary_event_fk
    FOREIGN KEY (primary_event_id) REFERENCES hrc_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- چه کسی، کِی و چرا وضعیت را عوض کرد — رد حسابرسی چرخهٔ عمر رویداد
CREATE TABLE IF NOT EXISTS hrc_event_transitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES hrc_events(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid REFERENCES members(id) ON DELETE SET NULL,
  note        text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_transitions_event
  ON hrc_event_transitions(event_id, at);

-- ═════════════════ ResponderAssignment — اعزام تیم/نفر به حادثه ═════════════════
CREATE TABLE IF NOT EXISTS hrc_responder_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id        uuid REFERENCES hrc_incidents(id) ON DELETE CASCADE,
  event_id           uuid REFERENCES hrc_events(id) ON DELETE SET NULL,
  team_id            uuid REFERENCES hrc_teams(id) ON DELETE SET NULL,
  responder_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  target_member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  role               text,
  status             text NOT NULL DEFAULT 'ASSIGNED'
                       CHECK (status IN ('ASSIGNED','ENROUTE','ONSITE','DONE','CANCELLED')),
  priority           text NOT NULL DEFAULT 'HIGH'
                       CHECK (priority IN ('NORMAL','HIGH','CRITICAL')),
  latitude           double precision,
  longitude          double precision,
  zone_id            uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  note               text,
  outcome            text,
  assigned_by        uuid REFERENCES members(id) ON DELETE SET NULL,
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  enroute_at         timestamptz,
  onsite_at          timestamptz,
  closed_at          timestamptz,
  legacy_dispatch_id uuid
);
CREATE INDEX IF NOT EXISTS idx_hrc_responder_status
  ON hrc_responder_assignments(status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_responder_incident
  ON hrc_responder_assignments(incident_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrc_responder_legacy
  ON hrc_responder_assignments(legacy_dispatch_id)
  WHERE legacy_dispatch_id IS NOT NULL;

-- ══════════════════════ SafetyZone — دایره یا چندضلعی ══════════════════════
ALTER TABLE hrc_zones
  ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'POLYGON',
  ADD COLUMN IF NOT EXISTS zone_type text NOT NULL DEFAULT 'SAFE_ZONE',
  ADD COLUMN IF NOT EXISTS center_lat double precision,
  ADD COLUMN IF NOT EXISTS center_lng double precision,
  ADD COLUMN IF NOT EXISTS radius_m double precision,
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE hrc_zones ADD CONSTRAINT hrc_zones_shape_check
    CHECK (shape IN ('CIRCLE','POLYGON'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE hrc_zones ADD CONSTRAINT hrc_zones_type_check
    CHECK (zone_type IN ('SAFE_ZONE','RESTRICTED_ZONE','HIGH_RISK_ZONE',
                         'EMERGENCY_ZONE','NO_ACCESS_ZONE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════ RiskRule — منطق در دیتابیس، نه در اپ ═══════════════════════
-- conditions/actions are JSON so the rules can be edited by a safety manager and
-- evaluated by the server; the Android client never decides policy.
--
--   conditions: {"all":[{"fact":"heart_rate","op":">","value":140}]}
--   actions:    {"event":"ABNORMAL_SENSOR_READING","severity":"HIGH",
--                "message":"ضربان قلب بالاتر از حد مجاز"}
CREATE TABLE IF NOT EXISTS hrc_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  enabled     boolean NOT NULL DEFAULT true,
  priority    int NOT NULL DEFAULT 100,
  conditions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity    text NOT NULL DEFAULT 'MEDIUM'
                CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  is_system   boolean NOT NULL DEFAULT false,
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════ Privacy policy — پایش فقط در شیفت/محوطه + نگهداشت ═══════════════
CREATE TABLE IF NOT EXISTS hrc_policies (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monitoring_mode          text NOT NULL DEFAULT 'SHIFT_ONLY'
                             CHECK (monitoring_mode IN ('SHIFT_ONLY','FACILITY_ONLY','ALWAYS')),
  retention_location_days  int NOT NULL DEFAULT 90,
  retention_event_days     int NOT NULL DEFAULT 365,
  retention_heartbeat_days int NOT NULL DEFAULT 30,
  retention_health_days    int NOT NULL DEFAULT 180,
  consent_required         boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- هر دسترسی به موقعیت یا سلامت افراد باید قابل حسابرسی باشد
CREATE TABLE IF NOT EXISTS hrc_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  action            text NOT NULL,
  resource          text,
  resource_id       uuid,
  subject_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  ip                text,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_audit_at ON hrc_audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_audit_subject
  ON hrc_audit_log(subject_member_id, at DESC);

-- شمارهٔ پرسنلی خوانا (EMP-1028) — اختیاری و افزودنی، هیچ کد موجودی به آن وابسته نیست
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS employee_code text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_employee_code
  ON members(employee_code) WHERE employee_code IS NOT NULL;
`;

/**
 * انتقال دادهٔ نسخهٔ ۱ به مدل جدید.
 *
 * Runs after the DDL, is idempotent through the `legacy_*_id` unique indexes,
 * and never touches the v1 tables — they stay exactly as they are.
 */
export const HRC_V2_BACKFILL = /* sql */ `
-- ── devices: fill the new descriptive columns from the old ones ──
UPDATE hrc_devices SET device_uid = serial WHERE device_uid IS NULL;
UPDATE hrc_devices SET device_type = CASE kind
    WHEN 'phone'  THEN 'ANDROID_PHONE'
    WHEN 'watch'  THEN 'WEAR_OS_WATCH'
    WHEN 'band'   THEN 'DEDICATED_WEARABLE'
    WHEN 'tag'    THEN 'BLE_TAG'
    WHEN 'beacon' THEN 'FUTURE_IOT_DEVICE'
    ELSE 'WEAR_OS_WATCH' END
  WHERE device_type = 'WEAR_OS_WATCH' AND kind IS NOT NULL AND kind <> 'watch';
UPDATE hrc_devices SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END
  WHERE status = 'ACTIVE' AND is_active = false;
UPDATE hrc_devices SET last_heartbeat_at = last_seen
  WHERE last_heartbeat_at IS NULL AND last_seen IS NOT NULL;

-- ── device assignments from the old single member_id column ──
INSERT INTO hrc_device_assignments (device_id, member_id, priority, assigned_at)
SELECT d.id, d.member_id, 'PRIMARY', d.created_at
FROM hrc_devices d
WHERE d.member_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hrc_device_assignments a
    WHERE a.device_id = d.id AND a.unassigned_at IS NULL);

-- ── locations out of the old combined readings table ──
INSERT INTO hrc_locations (member_id, device_id, recorded_at, received_at,
    latitude, longitude, accuracy_m, altitude, source, quality, confidence,
    zone_id, plan_x, plan_y, legacy_reading_id)
SELECT r.member_id, r.device_id, r.recorded_at, r.created_at,
       r.lat, r.lng, r.accuracy, r.altitude,
       CASE r.source
         WHEN 'gps'    THEN 'GPS'
         WHEN 'lbs'    THEN 'CELL'
         WHEN 'wifi'   THEN 'WIFI'
         WHEN 'beacon' THEN 'BLE_BEACON'
         WHEN 'lora'   THEN 'WEARABLE'
         WHEN 'manual' THEN 'MANUAL'
         ELSE 'GPS' END,
       -- anything that is not a satellite fix is an estimate, and says so
       CASE WHEN r.source = 'gps' THEN 'ACTUAL' ELSE 'ESTIMATED' END,
       CASE r.source
         WHEN 'gps'    THEN 0.900
         WHEN 'wifi'   THEN 0.600
         WHEN 'beacon' THEN 0.700
         WHEN 'lbs'    THEN 0.300
         ELSE 0.500 END,
       r.zone_id, r.x, r.y, r.id
FROM hrc_readings r
WHERE (r.lat IS NOT NULL OR r.x IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM hrc_locations l WHERE l.legacy_reading_id = r.id);

-- ── health readings out of the same source ──
INSERT INTO hrc_health_readings (member_id, device_id, recorded_at, heart_rate,
    spo2, skin_temp, steps, stress, activity_state, classification,
    legacy_reading_id)
SELECT r.member_id, r.device_id, r.recorded_at, r.heart_rate, r.spo2,
       r.body_temp, r.steps, r.stress, r.motion,
       CASE WHEN r.heart_rate IS NULL AND r.spo2 IS NULL AND r.body_temp IS NULL
            THEN 'SENSOR_UNAVAILABLE' ELSE 'NORMAL' END,
       r.id
FROM hrc_readings r
WHERE (r.heart_rate IS NOT NULL OR r.spo2 IS NOT NULL OR r.body_temp IS NOT NULL
       OR r.steps IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM hrc_health_readings h WHERE h.legacy_reading_id = r.id);

-- ── last known position per member ──
INSERT INTO hrc_last_position (member_id, location_id, device_id, recorded_at,
    latitude, longitude, accuracy_m, source, quality, confidence, zone_id,
    plan_x, plan_y, updated_at)
SELECT DISTINCT ON (l.member_id)
       l.member_id, l.id, l.device_id, l.recorded_at, l.latitude, l.longitude,
       l.accuracy_m, l.source, l.quality, l.confidence, l.zone_id,
       l.plan_x, l.plan_y, now()
FROM hrc_locations l
WHERE l.member_id IS NOT NULL
ORDER BY l.member_id, l.recorded_at DESC
ON CONFLICT (member_id) DO UPDATE SET
  location_id = EXCLUDED.location_id,
  device_id   = EXCLUDED.device_id,
  recorded_at = EXCLUDED.recorded_at,
  latitude    = EXCLUDED.latitude,
  longitude   = EXCLUDED.longitude,
  accuracy_m  = EXCLUDED.accuracy_m,
  source      = EXCLUDED.source,
  quality     = EXCLUDED.quality,
  confidence  = EXCLUDED.confidence,
  zone_id     = EXCLUDED.zone_id,
  plan_x      = EXCLUDED.plan_x,
  plan_y      = EXCLUDED.plan_y,
  updated_at  = now()
WHERE hrc_last_position.recorded_at IS NULL
   OR EXCLUDED.recorded_at > hrc_last_position.recorded_at;

-- ── alerts become events ──
INSERT INTO hrc_events (event_type, severity, status, source_category, member_id,
    device_id, zone_id, occurred_at, received_at, message, payload,
    legacy_alert_id)
SELECT
  CASE a.kind
    WHEN 'sos'       THEN 'SOS'
    WHEN 'fall'      THEN 'FALL_DETECTED'
    WHEN 'no_motion' THEN 'INACTIVITY_WARNING'
    WHEN 'geofence'  THEN 'GEOFENCE_ENTER'
    WHEN 'offline'   THEN 'DEVICE_OFFLINE'
    WHEN 'battery'   THEN 'LOW_BATTERY'
    WHEN 'manual'    THEN 'MANUAL'
    ELSE 'ABNORMAL_SENSOR_READING' END,
  CASE a.severity WHEN 'info' THEN 'INFO' WHEN 'critical' THEN 'CRITICAL'
                  ELSE 'MEDIUM' END,
  CASE a.status WHEN 'open' THEN 'CREATED' WHEN 'ack' THEN 'ACKNOWLEDGED'
                WHEN 'dispatched' THEN 'INVESTIGATING' WHEN 'resolved' THEN 'RESOLVED'
                ELSE 'CLOSED' END,
  CASE WHEN a.kind IN ('offline','battery') THEN 'DEVICE' ELSE 'EMPLOYEE' END,
  a.member_id, a.device_id, a.zone_id, a.created_at, a.created_at, a.message,
  -- the vital that tripped is preserved, without pretending it is a diagnosis
  jsonb_build_object('legacyKind', a.kind)
    || CASE WHEN a.kind IN ('heart_high','heart_low','spo2_low','temp_high','temp_low')
            THEN jsonb_build_object('metric', a.kind) ELSE '{}'::jsonb END
    -- the alert carried its own coordinates; hrc_events keeps them in the payload
    -- until Phase 3 writes a matching hrc_locations row and links location_id
    || CASE WHEN a.lat IS NOT NULL AND a.lng IS NOT NULL
            THEN jsonb_build_object('lat', a.lat, 'lng', a.lng) ELSE '{}'::jsonb END
    || CASE WHEN a.detail IS NOT NULL
            THEN jsonb_build_object('legacyDetail', a.detail) ELSE '{}'::jsonb END,
  a.id
FROM hrc_alerts a
WHERE NOT EXISTS (SELECT 1 FROM hrc_events e WHERE e.legacy_alert_id = a.id);

-- ── an incident for every event that was responded to, or was critical ──
INSERT INTO hrc_incidents (incident_no, member_id, primary_event_id, severity,
    status, title, opened_at, resolved_at, closed_at)
SELECT
  COALESCE((SELECT max(incident_no) FROM hrc_incidents), 0)
    + row_number() OVER (ORDER BY e.occurred_at),
  e.member_id, e.id, e.severity,
  CASE e.status WHEN 'CREATED' THEN 'OPEN' ELSE e.status END,
  e.message, e.occurred_at,
  CASE WHEN e.status IN ('RESOLVED','CLOSED') THEN e.occurred_at END,
  CASE WHEN e.status = 'CLOSED' THEN e.occurred_at END
FROM hrc_events e
WHERE e.incident_id IS NULL
  AND (e.severity = 'CRITICAL'
       OR EXISTS (SELECT 1 FROM hrc_dispatches d WHERE d.alert_id = e.legacy_alert_id));

UPDATE hrc_events e SET incident_id = i.id
FROM hrc_incidents i
WHERE i.primary_event_id = e.id AND e.incident_id IS NULL;

-- ── dispatches become responder assignments ──
INSERT INTO hrc_responder_assignments (incident_id, event_id, team_id,
    target_member_id, status, priority, latitude, longitude, zone_id, note,
    outcome, assigned_by, assigned_at, enroute_at, onsite_at, closed_at,
    legacy_dispatch_id)
SELECT e.incident_id, e.id, d.team_id, d.target_member_id,
       CASE d.status WHEN 'dispatched' THEN 'ASSIGNED' WHEN 'enroute' THEN 'ENROUTE'
                     WHEN 'onsite' THEN 'ONSITE' WHEN 'done' THEN 'DONE'
                     ELSE 'CANCELLED' END,
       CASE d.priority WHEN 'normal' THEN 'NORMAL' WHEN 'critical' THEN 'CRITICAL'
                       ELSE 'HIGH' END,
       d.lat, d.lng, d.zone_id, d.note, d.outcome, d.dispatched_by,
       d.dispatched_at, d.enroute_at, d.onsite_at, d.closed_at, d.id
FROM hrc_dispatches d
LEFT JOIN hrc_events e ON e.legacy_alert_id = d.alert_id
WHERE NOT EXISTS (
  SELECT 1 FROM hrc_responder_assignments r WHERE r.legacy_dispatch_id = d.id);

-- ── zones: derive the new type/shape from the old kind ──
UPDATE hrc_zones SET zone_type = CASE kind
    WHEN 'safe'       THEN 'SAFE_ZONE'
    WHEN 'restricted' THEN 'RESTRICTED_ZONE'
    WHEN 'hazard'     THEN 'HIGH_RISK_ZONE'
    WHEN 'muster'     THEN 'EMERGENCY_ZONE'
    WHEN 'gate'       THEN 'NO_ACCESS_ZONE'
    ELSE 'SAFE_ZONE' END
  WHERE zone_type = 'SAFE_ZONE' AND kind IS NOT NULL AND kind <> 'safe';

${HRC_V2_SEED}
`;
