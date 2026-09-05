/**
 * DDL for the optional panels — مالی (سیمرغ لجر)، انبار، HRC و درگاه API —
 * plus the per-person permission overrides.
 *
 * The statements are written **unqualified** and idempotent, so the exact same
 * text builds a brand-new tenant schema (`tenantDDL`) and upgrades an existing
 * one (`scripts/migrate.ts`); both run it with `search_path` pointed at the
 * tenant schema inside a transaction.
 */
export const ERP_DDL = /* sql */ `
-- ═══════════════ دسترسی جز‌به‌جز افراد (per-person overrides) ═══════════════
-- A grant adds a single permission to one person without giving them a whole
-- role; a deny takes one permission back from a role they hold.
CREATE TABLE IF NOT EXISTS member_permissions (
  member_id      uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  effect         text NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant','deny')),
  note           text,
  granted_by     uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, permission_key)
);

-- ═════════════════════════ مالی — سیمرغ لجر ═════════════════════════
CREATE TABLE IF NOT EXISTS fiscal_years (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  is_closed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chart of accounts: کل / معین / تفصیلی as a self-referencing tree.
ALTER TABLE ledger_accounts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS cost_centers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- طرف‌حساب — customers, suppliers, contractors, staff advances…
CREATE TABLE IF NOT EXISTS parties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'other'
                  CHECK (kind IN ('customer','supplier','employee','contractor','other')),
  national_id   text,
  economic_code text,
  phone         text,
  address       text,
  account_id    uuid REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- سند حسابداری — a voucher stays 'draft' until someone with
-- finance.entries.post makes it permanent; a posted voucher is never edited,
-- only voided (with an audit trail).
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS number int,
  ADD COLUMN IF NOT EXISTS fiscal_year_id uuid REFERENCES fiscal_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted','void')),
  ADD COLUMN IF NOT EXISTS ref_kind text,
  ADD COLUMN IF NOT EXISTS ref_id uuid,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entry_number
  ON ledger_entries(number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entry_date ON ledger_entries(entry_date);

ALTER TABLE ledger_lines
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_lines_account ON ledger_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_entry ON ledger_lines(entry_id);

-- ═══════════════════════════ انبار (Inventory) ═══════════════════════════
CREATE TABLE IF NOT EXISTS warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  location   text,
  manager_id uuid REFERENCES members(id) ON DELETE SET NULL,
  group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  parent_id  uuid REFERENCES item_categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  category_id  uuid REFERENCES item_categories(id) ON DELETE SET NULL,
  unit         text NOT NULL DEFAULT 'عدد',
  barcode      text,
  min_stock    numeric(18,3) NOT NULL DEFAULT 0,   -- نقطهٔ سفارش
  max_stock    numeric(18,3),
  last_price   numeric(18,2) NOT NULL DEFAULT 0,
  account_id   uuid REFERENCES ledger_accounts(id) ON DELETE SET NULL, -- حساب موجودی
  is_active    boolean NOT NULL DEFAULT true,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);

-- اسناد انبار: رسید ورود، حواله خروج، انتقال بین انبار، اصلاح موجودی.
CREATE TABLE IF NOT EXISTS stock_docs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          int,
  kind            text NOT NULL
                    CHECK (kind IN ('receipt','issue','transfer','adjust_in','adjust_out')),
  doc_date        date NOT NULL DEFAULT current_date,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id uuid REFERENCES warehouses(id) ON DELETE RESTRICT,
  party_id        uuid REFERENCES parties(id) ON DELETE SET NULL,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,  -- تحویل‌گیرنده/تحویل‌دهنده
  request_id      uuid,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','void')),
  note            text,
  ledger_entry_id uuid REFERENCES ledger_entries(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES members(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES members(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_docs_wh ON stock_docs(warehouse_id, doc_date);

CREATE TABLE IF NOT EXISTS stock_doc_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     uuid NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty        numeric(18,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(18,2) NOT NULL DEFAULT 0,
  note       text,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stock_lines_doc ON stock_doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS idx_stock_lines_item ON stock_doc_lines(item_id);

-- درخواست کالا — a member asks the warehouse for items; approval turns into
-- an issue document.
CREATE TABLE IF NOT EXISTS stock_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        int,
  requester_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  warehouse_id  uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  needed_date   date,
  note          text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','fulfilled')),
  decided_by    uuid REFERENCES members(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_requests_status ON stock_requests(status);

CREATE TABLE IF NOT EXISTS stock_request_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty          numeric(18,3) NOT NULL CHECK (qty > 0),
  approved_qty numeric(18,3),
  note         text
);

DO $$ BEGIN
  ALTER TABLE stock_docs
    ADD CONSTRAINT stock_docs_request_fk
    FOREIGN KEY (request_id) REFERENCES stock_requests(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Signed movements per warehouse (a transfer is an out-row plus an in-row),
-- and the live stock level built on top of the approved ones.
DROP VIEW IF EXISTS stock_levels;
DROP VIEW IF EXISTS stock_moves;
CREATE VIEW stock_moves AS
  SELECT d.id AS doc_id, d.number, d.kind, d.doc_date, d.status,
         d.warehouse_id, l.item_id, l.unit_price,
         CASE WHEN d.kind IN ('receipt','adjust_in') THEN l.qty ELSE -l.qty END AS qty
  FROM stock_docs d
  JOIN stock_doc_lines l ON l.doc_id = d.id
  UNION ALL
  SELECT d.id, d.number, d.kind, d.doc_date, d.status,
         d.to_warehouse_id, l.item_id, l.unit_price, l.qty
  FROM stock_docs d
  JOIN stock_doc_lines l ON l.doc_id = d.id
  WHERE d.kind = 'transfer' AND d.to_warehouse_id IS NOT NULL;

CREATE VIEW stock_levels AS
  SELECT warehouse_id, item_id, sum(qty) AS qty
  FROM stock_moves
  WHERE status = 'approved'
  GROUP BY warehouse_id, item_id;

-- ═════════════════ HRC — پایش سلامت، موقعیت و اعزام تیم ═════════════════
-- Smart watches / bands / tags worn by staff. Each device authenticates to the
-- ingest API with its own token.
CREATE TABLE IF NOT EXISTS hrc_devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial     text NOT NULL UNIQUE,
  token      text NOT NULL UNIQUE,
  model      text,
  kind       text NOT NULL DEFAULT 'watch'
               CHECK (kind IN ('watch','band','tag','phone','beacon')),
  member_id  uuid REFERENCES members(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  battery    int,
  firmware   text,
  last_seen  timestamptz,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_devices_member ON hrc_devices(member_id);

-- The company site map: either a georeferenced plan (lat/lng corners) or a
-- plain floor plan addressed in x/y percentages.
CREATE TABLE IF NOT EXISTS hrc_map (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title      text NOT NULL DEFAULT 'نقشهٔ شرکت',
  image_url  text,
  north      double precision,
  south      double precision,
  east       double precision,
  west       double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ناحیه‌بندی نقشه (ژئوفنس): polygon as [[lat,lng],…] in geo mode or
-- [[x,y],…] percentages in plan mode.
CREATE TABLE IF NOT EXISTS hrc_zones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'area'
                   CHECK (kind IN ('area','safe','restricted','hazard','gate','muster')),
  color          text NOT NULL DEFAULT '#38bdf8',
  coord_mode     text NOT NULL DEFAULT 'geo' CHECK (coord_mode IN ('geo','plan')),
  polygon        jsonb NOT NULL DEFAULT '[]'::jsonb,
  alert_on_enter boolean NOT NULL DEFAULT false,
  alert_on_exit  boolean NOT NULL DEFAULT false,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Telemetry stream: vitals + position. Position may come from GPS, the mobile
-- network (LBS/سلولی), Wi-Fi, a beacon or LoRa — «source» records which.
CREATE TABLE IF NOT EXISTS hrc_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,
  device_id   uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  heart_rate  int,
  spo2        int,
  body_temp   numeric(4,1),
  steps       int,
  stress      int,
  battery     int,
  motion      text,                 -- still | walking | running | fall
  lat         double precision,
  lng         double precision,
  accuracy    double precision,
  altitude    double precision,
  x           double precision,     -- plan-relative position (%)
  y           double precision,
  source      text NOT NULL DEFAULT 'gps'
                CHECK (source IN ('gps','lbs','wifi','beacon','lora','manual')),
  zone_id     uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  raw         jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_reading_member_time
  ON hrc_readings(member_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_reading_time ON hrc_readings(recorded_at DESC);

-- Company-tunable alert thresholds (single settings row).
CREATE TABLE IF NOT EXISTS hrc_thresholds (
  id                int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hr_min            int NOT NULL DEFAULT 45,
  hr_max            int NOT NULL DEFAULT 140,
  spo2_min          int NOT NULL DEFAULT 92,
  temp_min          numeric(4,1) NOT NULL DEFAULT 35.0,
  temp_max          numeric(4,1) NOT NULL DEFAULT 38.5,
  no_motion_minutes int NOT NULL DEFAULT 20,
  offline_minutes   int NOT NULL DEFAULT 15,
  battery_low       int NOT NULL DEFAULT 15,
  fall_alert        boolean NOT NULL DEFAULT true,
  geofence_alert    boolean NOT NULL DEFAULT true,
  auto_dispatch     boolean NOT NULL DEFAULT false,
  auto_dispatch_team uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hrc_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid REFERENCES members(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES hrc_devices(id) ON DELETE SET NULL,
  reading_id      uuid REFERENCES hrc_readings(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN
                    ('sos','fall','no_motion','heart_high','heart_low','spo2_low',
                     'temp_high','temp_low','geofence','offline','battery','manual')),
  severity        text NOT NULL DEFAULT 'warn'
                    CHECK (severity IN ('info','warn','critical')),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','ack','dispatched','resolved','false_alarm')),
  message         text,
  detail          jsonb,
  lat             double precision,
  lng             double precision,
  zone_id         uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  acked_by        uuid REFERENCES members(id) ON DELETE SET NULL,
  acked_at        timestamptz,
  resolved_by     uuid REFERENCES members(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrc_alerts_status ON hrc_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrc_alerts_member ON hrc_alerts(member_id, created_at DESC);

-- تیم‌های واکنش (امداد/آتش‌نشانی/HSE/حراست) و اعزام آن‌ها به محل حادثه.
CREATE TABLE IF NOT EXISTS hrc_teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'medical'
                  CHECK (kind IN ('medical','rescue','fire','safety','security')),
  phone         text,
  radio_channel text,
  base_location text,
  lat           double precision,
  lng           double precision,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hrc_team_members (
  team_id   uuid NOT NULL REFERENCES hrc_teams(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team_role text,
  PRIMARY KEY (team_id, member_id)
);

CREATE TABLE IF NOT EXISTS hrc_dispatches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id         uuid REFERENCES hrc_alerts(id) ON DELETE SET NULL,
  team_id          uuid REFERENCES hrc_teams(id) ON DELETE SET NULL,
  target_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'dispatched'
                     CHECK (status IN ('dispatched','enroute','onsite','done','cancelled')),
  priority         text NOT NULL DEFAULT 'high'
                     CHECK (priority IN ('normal','high','critical')),
  lat              double precision,
  lng              double precision,
  zone_id          uuid REFERENCES hrc_zones(id) ON DELETE SET NULL,
  note             text,
  outcome          text,
  dispatched_by    uuid REFERENCES members(id) ON DELETE SET NULL,
  dispatched_at    timestamptz NOT NULL DEFAULT now(),
  enroute_at       timestamptz,
  onsite_at        timestamptz,
  closed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_hrc_dispatch_status ON hrc_dispatches(status, dispatched_at DESC);

-- ═══════════════════ درگاه API برای نرم‌افزارهای دیگر ═══════════════════
-- Only the SHA-256 hash of a key is stored; the plaintext is shown once at
-- creation. «scopes» holds permission keys, so an external program never gets
-- more access than a person with the same keys would.
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  prefix       text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  expires_at   timestamptz,
  last_used_at timestamptz,
  call_count   bigint NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
`;
