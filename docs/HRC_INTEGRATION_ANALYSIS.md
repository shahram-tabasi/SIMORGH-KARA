# Simorgh Kara HRC — Integration Analysis

**Human Risk, Health & Crisis Monitoring** — architecture analysis and implementation
plan, produced **before** implementation for review and approval.

Status: **Phase 1 — awaiting approval.** No code from Phases 2–8 has been written yet.

---

## 0. Executive summary

Simorgh Kara is a Next.js 14 (App Router) multi-tenant SaaS with **schema-per-tenant**
PostgreSQL isolation. It already has an optional-panel (module) system, a granular RBAC
layer, an employee/organisation model, and — as of the current branch — a **first-generation
HRC panel** (`hrc` module: devices, readings, alerts, zones, teams, dispatches, an ingest
endpoint and a live map).

That v1 is a working vertical slice but it is **not** the device-agnostic platform this
specification describes. The gap is structural, not cosmetic:

| Spec requirement | HRC v1 today | Verdict |
|---|---|---|
| `SafetyDevice` + `DeviceAssignment`, 6 device types, priority & failover | one `hrc_devices` table, 5 kinds, single optional `member_id` | **evolve** |
| `SafetyEvent` with lifecycle CREATED→…→CLOSED, confidence, sync status | `hrc_alerts` with 5 statuses, no confidence, no client id | **replace** |
| `SafetyIncident` grouping events + `ResponderAssignment` | `hrc_dispatches` (flat, alert-linked) | **evolve** |
| `LocationRecord` with source/accuracy/**confidence**, actual vs estimated vs last-known | lat/lng columns inside `hrc_readings` | **split out** |
| Configurable backend `RiskRule` engine | hard-coded thresholds in `src/lib/hrc.ts` | **replace** |
| `DeviceHeartbeat` + device-vs-employee problem distinction | `last_seen`/`battery` columns only | **new** |
| Real-time push to the command centre | 15-second polling | **replace (SSE)** |
| Android phone + Wear OS apps | none (two unrelated Flutter apps exist) | **new** |
| Privacy policy, retention, audit log | none | **new** |
| Demo/simulation mode | static demo rows | **new** |

**Recommended strategy: evolve in place, do not fork.** Keep the `hrc` module key, the
panel entitlement, the permission catalogue and the tenant schema mechanism. Replace the
v1 *data model* with the specified domain entities through the existing idempotent
migration path. No other module (attendance, face recognition, leave, finance, inventory)
is touched.

**Honest constraints of this environment** (see §9): there is **no Android SDK** here, so
APKs cannot be assembled in this session — the shared Kotlin `core` modules can be
compiled and unit-tested, the two app targets are delivered as complete Gradle projects
built in Android Studio/CI. There is also **no test runner** in the project at all today;
Phase 8 has to add one.

---

## 1. Existing architecture detected

### 1.1 Runtime and topology

There is **no separate backend service**. "The backend" is Next.js itself:

```
Browser ──► Next.js 14 App Router (single Node process)
              ├─ Server Components  → read data directly via postgres.js
              ├─ Server Actions     → writes (forms post to functions)
              └─ Route Handlers     → /api/… JSON for devices & integrations
                        │
                        ▼
                 PostgreSQL (postgres.js pool, max 10)
```

- **`src/app/**`** — App Router. Tenant UI under `src/app/app/[slug]/…`, platform admin
  under `/admin`, holding under `/holding`, JSON APIs under `src/app/api/[slug]/…`.
- **`src/lib/**`** — server-only domain layer (`db`, `session`, `rbac`, `modules`,
  `hrc`, `finance`, `inventory`, `api-auth`, …).
- **`scripts/`** — `seed`, `demo`, `migrate`, `reset` run through `tsx`.
- Styling: Tailwind, RTL Persian, dark/light. No component library.
- **Dependencies are deliberately few**: `next, react, postgres, jose, bcryptjs, zod,
  server-only, @anthropic-ai/sdk`. Adding heavy infrastructure (Socket.IO, Redis, an ORM)
  would be a significant departure — this drives the real-time recommendation in §6.

### 1.2 Multi-tenancy and data isolation

```
platform schema (control plane)
  holdings(id, name, slug, max_companies, modules[])
  companies(id, name, slug, schema_name, domain, holding_id, status, plan,
            max_users, modules[])
  user_accounts(id, email, username, password_hash, full_name,
                is_platform_admin, is_holding_admin, holding_id, company_id, status)

tenant_<slug> schema (one per company) — members, roles, groups, kartabl, attendance,
  leave, finance, inventory, hrc_*, api_keys …
```

Isolation is enforced in `src/lib/db.ts::withTenant()`:

```ts
sql.begin(tx => { tx.unsafe(`SET LOCAL search_path TO "${safe}", platform, public`); … })
```

`SET LOCAL` inside a transaction is pool-safe — the search_path cannot leak into another
tenant's request. Schema names are validated against `/^tenant_[a-z0-9_]{1,50}$/`.

**Consequence for HRC:** every new table lives inside the tenant schema. There is no
cross-tenant table, and any HRC query must run inside `withTenant`. Time-series volume
(location + heartbeats) therefore lands per-tenant — see §4.4 on retention and partitioning.

### 1.3 Identity, authentication, sessions

- JWT (HS256, `jose`) in an **httpOnly cookie** `sk_session`, 7-day expiry, `SESSION_SECRET`
  from env. Passwords bcrypt-hashed.
- `SessionData.kind` is one of `platform | holding | tenant` — sessions are **browser-only**.
- Company-scoped login exists (`/c/<slug>` with a per-company `username`).

**Gap for HRC:** there is no employee-facing, device-facing credential. A phone or watch
cannot use a cookie session. Two device-auth precedents exist and neither is sufficient:

| Precedent | Mechanism | Problem for HRC |
|---|---|---|
| `attendance_devices.token` | plaintext token, `Bearer` | not hashed, not per-employee, not revocable per device, no rotation |
| `api_keys` (v1 gateway) | SHA-256 hash + scopes | machine-to-machine, not bound to an employee or to hardware |

§5.1 proposes the device identity model that closes this gap.

### 1.4 Authorisation — already strong, must be reused

Three layers, all already implemented:

1. **Module (panel) entitlement** — `platform.companies.modules[]`; the catalogue is
   `src/lib/modules.ts` (`org, hr, finance, inventory, hrc, api`). A holding can only
   grant panels the platform licensed to it.
2. **Roles** — `roles` / `role_permissions` / `member_roles`, permission keys from
   `src/lib/rbac.ts`.
3. **Per-person overrides** — `member_permissions(member_id, permission_key,
   effect grant|deny)`.

Effective permissions, computed once per request in `requireTenant()`:

```
(∪ role permissions + grants − denies) ∩ permissions of enabled modules
```

Eight `hrc.*` keys already exist (`hrc.view`, `hrc.monitor`, `hrc.devices.manage`,
`hrc.map.manage`, `hrc.alerts.manage`, `hrc.teams.manage`, `hrc.dispatch`,
`hrc.thresholds.manage`). §8 maps the spec's roles onto these rather than inventing a
parallel RBAC system.

### 1.5 Employee / organisation model (reuse, never duplicate)

| Spec concept | Existing entity | Notes |
|---|---|---|
| Employee | `members` (tenant) ↔ `platform.user_accounts` (global identity) | `members.id` is the HRC foreign key everywhere |
| Employee ID | `members.id` (uuid); human code via `user_accounts.username` | spec's `EMP-1028` style has no column yet — see §4.6 |
| Department | `groups` (self-referencing tree, `manager_id`) | HRC analytics group by this |
| Organisation | `platform.companies` (+ `holdings`) | |
| Roles | `roles` + `member_roles` | |
| Shift / work hours | `work_schedules`, `member_employment` | needed by the privacy "monitor only during shift" rule |

### 1.6 Migration mechanism

`src/lib/sql-erp.ts` holds idempotent DDL applied **both** at provisioning
(`tenantDDL()`) and by `npm run db:migrate`, which loops every tenant schema. This is the
project's migration system and the spec's "create migrations, don't touch production data
manually" requirement maps onto it directly. Verified idempotent earlier on a real
PostgreSQL 16 instance.

### 1.7 Existing HRC v1 surface (what is already on this branch)

Tables: `hrc_devices, hrc_map, hrc_zones, hrc_readings, hrc_thresholds, hrc_alerts,
hrc_teams, hrc_team_members, hrc_dispatches`.
Endpoints: `POST /api/<slug>/hrc/ingest` (device-token telemetry),
`GET /api/<slug>/v1/hrc/positions|alerts` (API-key gateway),
`GET /app/<slug>/hrc/feed` (dashboard polling).
UI: monitor, map, alerts, teams, dispatch, devices, zones, settings.

### 1.8 Mobile: what exists

`apps/guard` and `apps/mine-attendance` are **Flutter/Dart** apps for attendance
(face capture, GPS punch). They are unrelated to HRC and must keep working untouched.

**Decision — native Kotlin, not Flutter, for HRC.** The specification asks for Kotlin,
Wear OS, Android Keystore, Foreground Services, Health Services and the Wearable Data
Layer. Wear OS + health sensors + hardware-backed keys are first-class in native Kotlin
and awkward-to-unsupported in Flutter. The HRC apps are therefore a **new, separate Gradle
project** (`apps/hrc-android/`) that does not disturb the Flutter apps.

### 1.9 Testing — a real gap

`package.json` has **no test runner** (no vitest/jest, no Playwright config). Verification
so far has been manual scripts against a live database and a scripted browser. The spec
requires unit + integration tests for critical event flows, so Phase 8 must introduce the
harness (recommendation: **Vitest** for TS unit/integration, **JUnit + Turbine** for the
Kotlin core, Playwright for one dashboard smoke path).

---

## 2. Integration points

Everything in the "reuse" column is consumed as-is. Nothing there is modified.

| # | Integration point | How HRC connects | Risk |
|---|---|---|---|
| 1 | **Panel entitlement** | HRC stays module key `hrc`; already sold/toggled per company by platform & holding admins | none — mechanism proven |
| 2 | **Employees** | FK to `members.id`; no employee table of our own | none |
| 3 | **Departments** | FK to `groups.id` for zone ownership, responder teams, analytics | none |
| 4 | **RBAC** | new `hrc.*` permission keys added to the existing catalogue; spec roles become **role templates** (§8) | low — additive |
| 5 | **Auth (browser)** | command centre pages use `requireTenant()` + `guardPanel()` exactly like other panels | none |
| 6 | **Auth (device)** | **new** device identity layer (§5.1) issuing per-device JWTs bound to `members.id` | medium — new surface, security-critical |
| 7 | **Tenant isolation** | all queries via `withTenant`; device token carries `company_id` → schema resolved server-side | medium — the one place a bug crosses tenants; covered by tests |
| 8 | **Migrations** | new DDL appended to `sql-erp.ts`, applied by `db:migrate` | low |
| 9 | **Shifts** | privacy rule "monitor during shift only" reads `work_schedules` / `member_employment` | low |
| 10 | **Attendance** | HRC location is **not** attendance. A geofence entry must never create a punch. Explicitly out of scope; optional future bridge behind a flag | **important non-goal** |
| 11 | **API gateway** | existing `api_keys` scopes gain HRC read scopes for BI/integrations | low |
| 12 | **i18n** | app is Persian-only today; spec wants instant fa/en switching (§7.4) | medium — new capability, HRC-scoped first |

---

## 3. Proposed module structure

### 3.1 Backend / web (inside the existing Next.js app)

```
src/lib/hrc/                      ← new domain package (replaces flat src/lib/hrc.ts)
  domain/
    events.ts          SafetyEvent types, severities, lifecycle state machine
    devices.ts         device types, capabilities, priority & failover rules
    location.ts        LocationFix, sources, confidence scoring, quality classes
    zones.ts           circle/polygon geometry, point-in-zone, enter/exit diffing
    health.ts          health classification (conservative, non-diagnostic)
    incidents.ts       incident lifecycle, escalation policy
  engine/
    risk-engine.ts     rule evaluation (conditions → actions), pure & unit-testable
    rule-dsl.ts        JSON rule schema + zod validation
    detectors.ts       server-side inactivity / offline / stale-location detectors
    pipeline.ts        ingest → normalise → persist → evaluate → emit
  realtime/
    bus.ts             transport-agnostic publish/subscribe interface
    pg-notify.ts       Postgres LISTEN/NOTIFY implementation
    sse.ts             SSE stream serialisation
  auth/
    device-auth.ts     device JWT issue/verify, enrolment, revocation
    attestation.ts     public-key registration + challenge/response (Phase 3+)
  policy/
    privacy.ts         monitoring windows, retention, consent gates
    audit.ts           audit-log writer
  repo/                data access, one module per aggregate (all via withTenant)
  simulator/           demo scenario engine (§7.7)

src/app/api/v1/hrc/…              ← device-facing API (tenant from device token)
src/app/api/[slug]/v1/hrc/…       ← existing API-key gateway (kept, extended)
src/app/app/[slug]/hrc/…          ← HRC Command Center UI (restructured)
```

**Why a `src/lib/hrc/` package rather than more files in `src/lib/`:** the risk engine,
lifecycle rules and geometry are the parts that must be unit-tested without a database,
and they must be shareable in spirit (not code) with the Kotlin client. Keeping them
pure and isolated is what makes both possible.

### 3.2 Android (new Gradle project, isolated from the Flutter apps)

```
apps/hrc-android/
  settings.gradle.kts
  core/
    domain/     entities, event models, state machines   (pure Kotlin, JVM-testable)
    data/       repositories, Room entities/DAOs, mappers
    network/    Retrofit/Ktor client, DTOs, auth interceptor, retry policy
    security/   Keystore keys, device binding, challenge-response, secure storage
    location/   LocationProvider interface + GPS/Network/Wi-Fi/Cell/BLE providers
    sensors/    SensorProvider + HealthSensorProvider abstractions
    events/     event queue, dedupe, priority sync (SOS first), WorkManager jobs
    safety/     SOS orchestration, fall pipeline, inactivity, geofence evaluation
  android-phone/   phone app: UI, foreground service, gateway for the watch
  wear-os/         watch app: SOS-first UI, health sensors, phone/direct transport
```

Shared logic lives in `core/*`; only platform-specific UI and service wiring differ per
target. `core/domain`, `core/events` and the risk-relevant parts of `core/safety` are
plain Kotlin/JVM modules — **they compile and unit-test in this environment today**.

---

## 4. Database changes

All DDL goes into the existing idempotent migration path (`src/lib/sql-erp.ts` →
`npm run db:migrate`), per tenant schema. Naming stays `hrc_*`.

### 4.1 Devices and assignment

```sql
hrc_devices                              -- SafetyDevice (evolves the v1 table)
  id, device_uid text UNIQUE             -- stable client-generated id
  device_type   text CHECK IN (ANDROID_PHONE, WEAR_OS_WATCH, DEDICATED_WEARABLE,
                               BLE_TAG, NFC_DEVICE, FUTURE_IOT_DEVICE)
  model, manufacturer, os_version, app_version
  capabilities  jsonb                    -- {gps, ble, heartRate, fallDetection, cellular…}
  public_key    text                     -- Keystore public key (device binding)
  attestation   jsonb                    -- Play Integrity / key attestation (later)
  status        text CHECK IN (ACTIVE, SUSPENDED, RETIRED)
  gateway_device_id uuid REFERENCES hrc_devices(id)   -- watch → phone gateway
  last_heartbeat_at timestamptz, battery int, network text, is_simulated bool

hrc_device_assignments                   -- DeviceAssignment (history, not a column)
  id, device_id, member_id, priority text CHECK IN (PRIMARY, SECONDARY, BACKUP)
  assigned_at, unassigned_at, assigned_by
  UNIQUE (device_id) WHERE unassigned_at IS NULL
```

Failover (§22.4) is a **query over assignments**, not app state: an employee's active
device is the lowest-priority-number assignment with a fresh heartbeat.

### 4.2 Events and incidents

```sql
hrc_events                               -- SafetyEvent
  id uuid, client_event_id text          -- idempotency key from the device
  event_type text CHECK IN (SOS, FALL_DETECTED, INACTIVITY_WARNING, GEOFENCE_ENTER,
      GEOFENCE_EXIT, HIGH_RISK_ZONE_ENTERED, DEVICE_OFFLINE, LOW_BATTERY,
      LOCATION_DISABLED, ABNORMAL_SENSOR_READING, WATCH_DISCONNECTED,
      APP_PERMISSION_ERROR, NO_NETWORK, MANUAL)
  severity text CHECK IN (INFO, LOW, MEDIUM, HIGH, CRITICAL)
  status   text CHECK IN (CREATED, ACKNOWLEDGED, INVESTIGATING, RESOLVED, CLOSED)
  member_id, device_id, incident_id
  occurred_at, received_at               -- device clock vs server clock, both kept
  location_id, confidence numeric(4,3), detector_version text
  payload jsonb, is_simulated bool, source_category text (EMPLOYEE | DEVICE)
  UNIQUE (device_id, client_event_id)    -- dedupe across offline retries

hrc_event_transitions                    -- lifecycle audit: who moved it, when, why
hrc_incidents                            -- SafetyIncident (groups events)
  id, incident_no int, member_id, primary_event_id, severity, status,
  opened_at, acknowledged_at, resolved_at, closed_at, resolution_note
hrc_responder_assignments                -- ResponderAssignment (replaces hrc_dispatches)
  id, incident_id, team_id, responder_member_id, role,
  status CHECK IN (ASSIGNED, ENROUTE, ONSITE, DONE, CANCELLED), timestamps, outcome
```

`source_category` is what lets the command centre separate **employee emergency** from
**device technical problem** (§7 of the spec) in every list and metric.

### 4.3 Location

```sql
hrc_locations                            -- LocationRecord (time-series)
  id, member_id, device_id, recorded_at,
  latitude, longitude, accuracy_m, altitude,
  source text CHECK IN (GPS, NETWORK, WIFI, CELL, BLE_BEACON, UWB, MANUAL, WEARABLE)
  confidence numeric(4,3),
  quality text CHECK IN (ACTUAL, ESTIMATED, LAST_KNOWN)   -- spec §3, non-negotiable
  zone_id, plan_x, plan_y, is_simulated
```

`quality` + `confidence` + `accuracy_m` together prevent the dishonesty the spec warns
about: a Cell-ID fix is stored as `source=CELL, quality=ESTIMATED, accuracy_m≈1500,
confidence≈0.3` and the UI renders it as an uncertainty circle, never as a precise pin.

### 4.4 Heartbeats, health, zones, rules, policy, audit

```sql
hrc_heartbeats      device_id, at, battery, charging, network, gps_enabled,
                    permissions jsonb, app_state, watch_connected
hrc_health_readings member_id, device_id, at, heart_rate, hrv, spo2, skin_temp,
                    activity_state, classification CHECK IN (NORMAL, ABNORMAL_READING,
                    SENSOR_UNAVAILABLE, UNKNOWN), is_simulated
hrc_zones           + shape CHECK IN (CIRCLE, POLYGON), center_lat/lng, radius_m,
                    zone_type CHECK IN (SAFE_ZONE, RESTRICTED_ZONE, HIGH_RISK_ZONE,
                    EMERGENCY_ZONE, NO_ACCESS_ZONE), building, floor
hrc_rules           name, enabled, priority, when jsonb, then jsonb, severity, version
hrc_policies        single row: monitoring_mode (SHIFT_ONLY|FACILITY_ONLY|ALWAYS),
                    retention_location_days, retention_event_days, consent_required
hrc_audit_log       actor_member_id, action, subject_member_id, resource, at, ip, meta
```

**Retention & volume.** A 30-second location cadence is ~2,880 rows/employee/day. For 500
employees that is ~1.4M rows/day/tenant. Mitigations, in the migration from day one:
`hrc_locations` and `hrc_heartbeats` carry a `recorded_at` index and are pruned by a
retention job driven by `hrc_policies`; the "current position" read path uses a
`hrc_last_position` table updated on write (not a `LATERAL` over the history). Monthly
partitioning is deferred until a tenant actually needs it.

### 4.5 Migration from HRC v1

`hrc_readings` splits into `hrc_locations` + `hrc_health_readings`; `hrc_alerts` becomes
`hrc_events` (+ auto-created incidents for critical rows); `hrc_dispatches` becomes
`hrc_responder_assignments`. Data volume today is demo-only, but the migration is written
as real backfill SQL — the spec forbids manual production surgery. `hrc_map`,
`hrc_teams`, `hrc_team_members`, `hrc_thresholds` survive (thresholds become the seed of
the default rule set).

### 4.6 One open question

The spec shows human-readable employee IDs (`EMP-1028`). There is no such column today
(`members` has a uuid; `user_accounts.username` is a login name). Recommendation: add
`members.employee_code text` (nullable, unique per tenant), auto-generated on demand.
It touches a shared table — flagged for approval rather than assumed.

---

## 5. API plan

### 5.1 Device identity (the one genuinely new security surface)

```
1. Enrolment   employee signs in on the phone with company slug + username + password
               → server returns a short-lived, single-use enrolment ticket
2. Binding     app generates a keypair in Android Keystore (StrongBox when available)
               → POST public key + device metadata + ticket
               → server creates SafetyDevice + DeviceAssignment
3. Session     server issues a device JWT (sub = member_id, aud = device_uid,
               tenant = company_id, 30 days, revocable by device row)
4. Refresh     challenge/response signed by the Keystore key → new device JWT
5. Revocation  setting the device to SUSPENDED/RETIRED invalidates it server-side
```

Private keys never leave the Keystore; the server stores only public keys. Tokens are
verified with the existing `jose` dependency — no new library. Play Integrity / key
attestation is designed for but deferred to a later phase.

### 5.2 Endpoints

Device-facing, tenant resolved **from the token** (a device must not have to know a URL
slug that can change):

```
POST /api/v1/hrc/auth/enroll          exchange enrolment ticket → device JWT
POST /api/v1/hrc/auth/refresh         challenge-response refresh
POST /api/v1/hrc/devices/heartbeat    battery, network, permissions, watch link
POST /api/v1/hrc/location             batch of location fixes (idempotent)
POST /api/v1/hrc/events               batch of events (idempotent, SOS prioritised)
POST /api/v1/hrc/sos                  dedicated low-latency SOS path
GET  /api/v1/hrc/config               zones, rules digest, cadence, policy for this device
GET  /api/v1/hrc/status               this employee's own safety state
```

Operator/dashboard-facing (cookie session + `hrc.*` permissions):

```
GET  /api/v1/hrc/stream               SSE — live events, positions, device state
GET/POST/PATCH  /api/v1/hrc/incidents[/:id]     lifecycle transitions
GET/POST/PATCH/DELETE  /api/v1/hrc/zones[/:id]
GET/POST/PATCH/DELETE  /api/v1/hrc/rules[/:id]
GET/PATCH              /api/v1/hrc/devices[/:id]
POST /api/v1/hrc/simulator/{start|stop|scenario}   demo mode (§7.7)
```

Integration-facing (existing API-key gateway, unchanged convention):
`/api/<slug>/v1/hrc/positions|alerts|incidents` with `api_keys` scopes.

**Path convention note.** The spec asks for `/api/v1/hrc/*`; the repo's existing pattern
is `/api/<slug>/v1/*`. Recommendation: use `/api/v1/hrc/*` for device traffic (tenant from
token, as above) and keep `/api/<slug>/v1/*` for API-key integrations. Both documented;
neither breaks the other. **This is decision D2 in §10.**

### 5.3 Conventions

Idempotency via `client_event_id`; batch endpoints capped (200 items) and partially
successful (per-item results); every response `{ ok, data | error, requestId }`; zod
validation at every boundary; structured logs with `requestId` + `tenant` + `deviceId`;
rate limits per device. All configuration through env vars — no secrets in code.

---

## 6. Real-time architecture

### 6.1 The constraint

Next.js App Router route handlers **cannot hold a WebSocket** under `next start` without
replacing the Next server with a custom Node server. Socket.IO would therefore mean a new
server entry point, a new dependency, and a different deployment shape — a large change to
a project whose whole architecture is "Next.js and Postgres, nothing else".

### 6.2 Recommendation: SSE + Postgres LISTEN/NOTIFY, behind an interface

```
device → POST /api/v1/hrc/events
            → pipeline: normalise → persist → risk engine → incident
            → pg_notify('hrc_events', payload)
                    │
        ┌───────────┴───────────┐          (fan-out works across app instances)
   instance A               instance B
   LISTEN hrc_events        LISTEN hrc_events
        │                        │
   GET /api/v1/hrc/stream (SSE, per-tenant, permission-filtered)
        │
   HRC Command Center (EventSource, auto-reconnect, Last-Event-ID replay)
```

- **Why it fits:** the dashboard only needs server→client push. SSE is one route handler,
  no new dependency, works with `next start`, survives multi-instance via NOTIFY, and
  reconnects natively.
- **Why not polling (today's v1):** 15-second latency is unacceptable for SOS.
- **Migration path preserved:** `realtime/bus.ts` is a transport-agnostic interface;
  swapping in Socket.IO later is one implementation file plus a custom server, with no
  change to the pipeline or the UI's subscription hook.
- **Limits to state honestly:** NOTIFY payloads are capped at 8000 bytes (we publish
  compact envelopes, the client fetches detail), and SSE over HTTP/1.1 shares the 6
  connections-per-origin budget — one stream per tab, not per widget.

Push notifications to responders' phones (FCM) are a Phase 4 add-on, not part of the
dashboard transport.

---

## 7. HRC Command Center (UI plan)

Restructured under `src/app/app/[slug]/hrc/`, in the existing visual language
(Tailwind, RTL, dark/light) — an enterprise control-room feel, not an admin template.

1. **Live Safety Map** — employees coloured NORMAL/WARNING/EMERGENCY/OFFLINE, uncertainty
   circles sized by `accuracy_m`, zones by type, active incidents pulsing, offline devices
   at last-known position (visually distinct — dimmed + "last seen" badge).
2. **Active Incidents** — id, employee, type, severity, time, location, status, responder;
   one-click acknowledge → investigate → resolve, with responder assignment.
3. **Employee Safety Monitor** — every monitored employee, current state, device, battery,
   network, last seen.
4. **Device Monitoring** — online/offline, low battery, permission problems, watch
   disconnected; the "device problem" lane kept visually separate from emergencies.
5. **Risk Analytics** — incidents by department/zone, common event types, average response
   time, offline-device rate, safety trend.
6. **Configuration** — zones (draw circle/polygon on the map), risk rules, policy,
   retention, audit log viewer.

**i18n (§19).** The app is Persian-only today. HRC introduces a scoped dictionary
(`fa`/`en`) with an instant switcher and `dir` flip, applied to HRC screens first; a
future pass can adopt it app-wide. This is additive and does not touch existing pages.

**Demo mode (§20, §22.7).** A server-side scenario engine drives simulated employees and
devices through the *real* pipeline — every simulated row carries `is_simulated = true`,
is badged **«شبیه‌سازی / SIMULATED»** in the UI, and is excluded from analytics by default.
Scenarios: normal movement, restricted-zone entry, battery drain, going offline, SOS,
possible fall, inactivity, escalation.

---

## 8. RBAC mapping

The spec's roles become **role templates** built from permission keys — the existing
mechanism — not a second authorisation system. Employees keep seeing only their own data
through `hrc.view`; everything cross-employee requires `hrc.monitor` or above.

| Spec role | Permission keys |
|---|---|
| `EMPLOYEE` | `hrc.view` (self only), `hrc.device.self` *(new)* |
| `SECURITY_GUARD` | `hrc.monitor`, `hrc.incidents.view`, `hrc.incidents.ack` |
| `RESPONDER` | + `hrc.incidents.respond` |
| `SUPERVISOR` | + `hrc.monitor`, department-scoped, `hrc.analytics.view` |
| `SAFETY_MANAGER` | + `hrc.zones.manage`, `hrc.rules.manage`, `hrc.devices.manage` |
| `HRC_ADMIN` | all of the above + `hrc.policy.manage`, `hrc.audit.view`, `hrc.simulator.run` |

New keys (additive to `src/lib/rbac.ts`): `hrc.device.self`, `hrc.incidents.view`,
`hrc.incidents.ack`, `hrc.incidents.respond`, `hrc.zones.manage`, `hrc.rules.manage`,
`hrc.policy.manage`, `hrc.audit.view`, `hrc.analytics.view`, `hrc.simulator.run`.
The v1 keys are retained and mapped so no existing role loses access.

---

## 9. Android architecture

### 9.1 Shared core, two targets

```
                    Simorgh Kara HRC Backend
                              │
                    ┌─────────┴─────────┐
              android-phone          wear-os
                    └──── core/* (shared Kotlin) ────┘
```

- **Stack:** Kotlin, Clean Architecture + MVVM, Repository pattern, Coroutines/Flow,
  Room (offline queue), WorkManager (sync), Retrofit/OkHttp, Hilt, Compose (phone) +
  Compose for Wear OS (watch), Android Keystore, Fused Location, Health Services (watch).
- **`LocationProvider` interface** with GPS/GNSS, Network, Wi-Fi, Cell, BLE-beacon
  implementations; the engine fuses them into a `LocationFix(lat, lng, accuracy, source,
  confidence, quality, timestamp)` — the same shape the API and database use.
- **`HealthSensorProvider` interface** — no data is fabricated on the phone MVP; the watch
  supplies real Health Services data where permitted, and demo mode marks anything
  simulated.
- **Offline-first:** Room queue with dedupe on `clientEventId`, exponential backoff,
  priority lanes (SOS jumps the queue and retries aggressively), last-known-state cache.
- **Foreground service** only while monitoring is active, with a persistent notification,
  respecting Android background restrictions and runtime permissions.
- **Phone↔watch:** Wearable Data Layer (MessageClient/DataClient). Watch uses the phone as
  gateway when it has no independent network; goes direct when it does; the phone raises
  `WATCH_DISCONNECTED` when the link drops. Every event carries its `sourceDevice`.
- **Device independence:** the backend contract (device types, event schema, transports)
  has nothing Wear OS-specific in it, so a future dedicated Simorgh wearable registers as
  `DEDICATED_WEARABLE` and speaks the same API without platform changes.

### 9.2 What can and cannot be verified in this environment — stated plainly

| Deliverable | Buildable here? |
|---|---|
| `core/domain`, `core/events`, risk/geometry logic (pure Kotlin/JVM) | **yes** — Gradle + JDK 21 present; compiled and unit-tested |
| `android-phone`, `wear-os` (Android Gradle Plugin) | **no** — no Android SDK installed; delivered as complete projects, built in Android Studio/CI |
| Sensor/health/Keystore/Wear behaviour | **no** — requires physical devices; the demo simulator exists precisely so the backend and dashboard can be demonstrated and tested without hardware |

`dl.google.com` is reachable, so a CI job (or an approved SDK install here) can assemble
the APKs; that is a Phase 8 task, not an assumption.

---

## 10. Decisions needed before Phase 2

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Evolve HRC v1 tables into the spec model (with backfill), or keep v1 and add a parallel model? | **Evolve.** v1 data is demo-only; two parallel models would be permanent debt. |
| **D2** | API paths: spec's `/api/v1/hrc/*` vs repo's `/api/<slug>/v1/*` | **Both, by audience:** `/api/v1/hrc/*` for devices (tenant from token), `/api/<slug>/v1/*` for API-key integrations. |
| **D3** | Real-time transport now | **SSE + LISTEN/NOTIFY**, behind a transport interface; Socket.IO later if bidirectional need appears. |
| **D4** | Add `members.employee_code` for human-readable employee IDs | **Yes**, nullable and additive — it touches a shared table, so it needs explicit approval. |
| **D5** | Test harness | **Vitest** (TS) + **JUnit** (Kotlin core) + one Playwright smoke path, introduced in Phase 8 but written alongside each phase. |

---

## 11. Implementation roadmap

| Phase | Contents | Verifiable here |
|---|---|---|
| **1** | This analysis | ✔ done |
| **2** | Schema + migrations: all tables in §4, backfill from v1, retention/audit scaffolding, seed default rules | ✔ against real PostgreSQL, idempotency re-run |
| **3** | Backend API: device identity & enrolment, ingest pipeline, risk engine, incident lifecycle, RBAC keys, privacy policy gate, audit log, OpenAPI docs | ✔ HTTP tests against a running server |
| **4** | Real-time: NOTIFY publisher, SSE stream, permission-filtered subscriptions, dashboard live wiring | ✔ two-client SSE test with real events |
| **5** | Android: Gradle project, shared `core/*`, phone MVP, Wear OS MVP, offline queue, phone↔watch link | ⚠ core compiles/tests here; APKs need SDK/CI |
| **6** | HRC Command Center: map, incidents, monitor, device board, analytics, config screens, fa/en switcher | ✔ browser-driven tests |
| **7** | Demo simulator: scenario engine, `SIMULATED` badging, one-click investor demo | ✔ end-to-end through the real pipeline |
| **8** | Testing & deployment: Vitest + JUnit harness, critical-flow integration tests, CI for APK assembly, deployment/ops docs, retention job scheduling | ✔ except APK assembly |

Each phase lands as its own commit with migrations, tests and documentation, and does not
touch modules outside HRC.

---

## 12. Risks and non-goals

**Risks.** (1) Device auth is the highest-value new attack surface — Keystore binding,
revocation and tenant-scoped token verification get dedicated tests. (2) Location volume
per tenant — mitigated by `hrc_last_position`, indexes and retention from day one.
(3) Android background limits (Doze, OEM battery managers) can silence a safety app —
requires foreground service, battery-optimisation guidance and an explicit
"monitoring inactive" state in the dashboard rather than a false NORMAL. (4) Privacy and
labour-law exposure of continuous location tracking — the policy layer, shift-window
restriction and audit log are mandatory, not optional. (5) Demo data leaking into real
analytics — prevented by `is_simulated` on every table and default exclusion.

**Non-goals, stated plainly.** HRC is not a medical device and makes no diagnoses — it
reports "abnormal physiological reading detected — manual assessment recommended". Fall
detection is best-effort with a confidence score, never a certified life-safety
guarantee. HRC location does not feed attendance. Nothing here alters the attendance,
face-recognition, leave, finance or inventory modules.
