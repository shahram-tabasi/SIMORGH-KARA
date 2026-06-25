/**
 * DDL for the control-plane (`platform`) schema and the per-tenant schema
 * template. Kept as plain SQL strings so they can be applied idempotently
 * during seeding and tenant provisioning.
 */

export const PLATFORM_DDL = /* sql */ `
CREATE SCHEMA IF NOT EXISTS platform;
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;          -- case-insensitive email

-- Holdings = a group of companies (sections) owned by one organisation.
CREATE TABLE IF NOT EXISTS platform.holdings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Companies = tenants. Each has its own dedicated schema. A company may
-- belong to a holding (e.g. a section: فنی، تولید، انبار…).
CREATE TABLE IF NOT EXISTS platform.companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  schema_name  text NOT NULL UNIQUE,
  holding_id   uuid REFERENCES platform.holdings(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','pending')),
  plan         text NOT NULL DEFAULT 'standard',
  max_users    integer NOT NULL DEFAULT 10,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Global identity / auth records. Used to resolve which tenant a login
-- belongs to. Platform super-admins have company_id = NULL; holding admins
-- have company_id = NULL and holding_id set with is_holding_admin = true.
CREATE TABLE IF NOT EXISTS platform.user_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  full_name          text NOT NULL,
  is_platform_admin  boolean NOT NULL DEFAULT false,
  is_holding_admin   boolean NOT NULL DEFAULT false,
  holding_id         uuid REFERENCES platform.holdings(id) ON DELETE CASCADE,
  company_id         uuid REFERENCES platform.companies(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','disabled')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_company
  ON platform.user_accounts(company_id);
`;

/**
 * Returns the DDL that builds a fresh tenant schema. The objects are created
 * *unqualified* and rely on the search_path being set to the new schema, so
 * the same template works for every company.
 */
export function tenantDDL(schema: string): string {
  return /* sql */ `
CREATE SCHEMA IF NOT EXISTS "${schema}";
SET LOCAL search_path TO "${schema}", platform, public;

-- A member is a person inside the company. Links to a global account.
CREATE TABLE IF NOT EXISTS members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL,               -- platform.user_accounts.id
  full_name   text NOT NULL,
  title       text,                          -- job title / position
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','disabled')),
  schedule_id uuid,                          -- work_schedules.id (HR module)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

-- Roles: a named bundle of permissions (RBAC).
CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The permissions granted to a role (permission keys come from the app).
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS member_roles (
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, role_id)
);

-- Sub-groups / departments — self-referencing tree.
CREATE TABLE IF NOT EXISTS groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  parent_id  uuid REFERENCES groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_groups (
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, group_id)
);

-- Kartabl = a personal cartable / inbox / workspace owned by a member.
CREATE TABLE IF NOT EXISTS kartabls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kartabl_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kartabl_id  uuid NOT NULL REFERENCES kartabls(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text,
  kind        text NOT NULL DEFAULT 'task'
                CHECK (kind IN ('task','document','message','approval')),
  status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','done','archived')),
  -- Optional link to another record (e.g. a leave request awaiting approval).
  ref_kind    text,
  ref_id      uuid,
  -- The member who created/assigned this item. Only the assigner (or a
  -- kartabl manager acting on someone else's kartabl) may edit or delete it;
  -- the recipient can only report progress via status. This keeps tasks
  -- assigned to a person — even the CEO — tamper-proof for accountability.
  created_by  uuid REFERENCES members(id) ON DELETE SET NULL,
  -- optional reminder time (یادآوری) — surfaced in-app and exportable to ICS
  remind_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kartabl_items_kartabl ON kartabl_items(kartabl_id);

-- «میز کار» — team tasks / work orders (separate from the leave kartabl).
-- A task may be broadcast to a whole subgroup or sent to individuals, carry a
-- priority (urgent/forced) and a date range, and be delegated (parent_id).
CREATE TABLE IF NOT EXISTS work_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text,
  code        text,                          -- optional work-order code
  priority    text NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('normal','urgent','forced')),
  from_date   date,
  due_date    date,
  created_by  uuid REFERENCES members(id) ON DELETE SET NULL,
  group_id    uuid REFERENCES groups(id) ON DELETE SET NULL,   -- set when broadcast
  parent_id   uuid REFERENCES work_tasks(id) ON DELETE SET NULL, -- delegation chain
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_task_assignees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','done')),
  -- set when a member transfers (واگذاری) a received task to a colleague
  delegated_from uuid REFERENCES members(id) ON DELETE SET NULL,
  -- set when the assignee confirms receipt (تأیید دریافت) — a read receipt
  acknowledged_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignee_member ON work_task_assignees(member_id);
CREATE INDEX IF NOT EXISTS idx_work_tasks_creator ON work_tasks(created_by);

-- HR / Calendar module (stage 1) ------------------------------------------

-- A work schedule: which weekdays are working days and the daily hours.
-- work_days holds Iranian weekday indices (0=Saturday … 6=Friday).
CREATE TABLE IF NOT EXISTS work_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  work_days   int[] NOT NULL DEFAULT '{0,1,2,3,4}',
  start_time  text NOT NULL DEFAULT '08:00',
  end_time    text NOT NULL DEFAULT '17:00',
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Holidays (official or company-specific), keyed by Gregorian date.
CREATE TABLE IF NOT EXISTS holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  title        text NOT NULL,
  is_official  boolean NOT NULL DEFAULT true,
  -- true = day off (تعطیل)؛ false = informational occasion (مناسبت غیرتعطیل)
  is_off       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-date schedule exceptions set by HR (کارگزینی): force a normally-working
-- day off, or turn a shift's rest day into a working day (e.g. a bridge day).
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  override_date date NOT NULL UNIQUE,
  is_working    boolean NOT NULL,  -- true = working day، false = استراحت/تعطیل
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Attendance (stage 2): one row per member per day, with punch times.
CREATE TABLE IF NOT EXISTS attendance_days (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  work_date  date NOT NULL,
  check_in   timestamptz,
  check_out  timestamptz,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_days(work_date);

-- Individual punches (stage 4.3): supports multiple in/out per day.
CREATE TABLE IF NOT EXISTS attendance_punches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  punched_at timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL CHECK (kind IN ('in','out')),
  -- self | manual (HR) | device (terminal) | guard (app) | mobile (miner app)
  source     text NOT NULL DEFAULT 'self',
  photo_url  text,                 -- captured face photo (guard/mobile)
  lat        double precision,     -- GPS (mobile/mine attendance)
  lng        double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_punch_member_time
  ON attendance_punches(member_id, punched_at);

-- Time-clock devices & mobile apps authenticate to the ingest API with a token.
CREATE TABLE IF NOT EXISTS attendance_devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  token      text NOT NULL UNIQUE,
  kind       text NOT NULL DEFAULT 'terminal'
               CHECK (kind IN ('terminal','guard','mobile')),
  is_active  boolean NOT NULL DEFAULT true,
  last_seen  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enrolled face embeddings (vectors) for automatic recognition. The embedding
-- is computed on-device (TFLite); the server only stores it (L2-normalized)
-- and does cheap cosine matching. Multiple samples per member are allowed.
CREATE TABLE IF NOT EXISTS face_embeddings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  vec        jsonb NOT NULL,         -- array of floats, L2-normalized
  dim        int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_face_member ON face_embeddings(member_id);

-- Attendance policy / company rules (stage 3): single settings row.
CREATE TABLE IF NOT EXISTS attendance_policy (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  grace_minutes          int NOT NULL DEFAULT 0,        -- allowed lateness
  standard_daily_minutes int NOT NULL DEFAULT 480,      -- 8h working day
  monthly_leave_days     numeric(5,1) NOT NULL DEFAULT 2.5,
  annual_leave_days      numeric(5,1) NOT NULL DEFAULT 26,
  overtime_enabled       boolean NOT NULL DEFAULT true,
  -- HR-set caps on manual (self) تردد registrations; 0 = unlimited
  max_punches_per_week   int NOT NULL DEFAULT 0,
  max_punches_per_month  int NOT NULL DEFAULT 0
);

-- Employment profile (stage 5.2): drives entitlement accrual and the
-- site-specific "minutes that equal one leave day".
CREATE TABLE IF NOT EXISTS member_employment (
  member_id          uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  hire_date          date NOT NULL DEFAULT current_date,
  site               text NOT NULL DEFAULT 'hq' CHECK (site IN ('hq','factory','guard')),
  daily_work_minutes int NOT NULL DEFAULT 510, -- hq 08:30, factory 07:20
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Entitlement ledger (stage 5.2): manual carry-over / buyback / adjustments.
-- Monthly accrual and usage are computed live; this table only stores the
-- carry-in cap, forfeits, buy-backs and manual corrections.
CREATE TABLE IF NOT EXISTS leave_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  jyear       int NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('carry_in','forfeit','buyback','adjust')),
  days        numeric(6,2) NOT NULL, -- signed: + increases, - decreases balance
  note        text,
  created_by  uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_member ON leave_ledger(member_id, jyear);

-- Configurable leave-type catalogue (stage 5): each company tunes its rules.
CREATE TABLE IF NOT EXISTS leave_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  unit                  text NOT NULL DEFAULT 'day' CHECK (unit IN ('day','hour')),
  paid                  boolean NOT NULL DEFAULT true,
  deducts_entitlement   boolean NOT NULL DEFAULT true,
  counts_inner_holidays boolean NOT NULL DEFAULT false,
  requires_attachment   boolean NOT NULL DEFAULT false,
  max_minutes_per_day   int,
  max_count_per_month   int,
  max_count_per_week    int,
  max_days_per_year     numeric(6,1),
  approval_levels       int NOT NULL DEFAULT 1,
  is_active             boolean NOT NULL DEFAULT true,
  is_system             boolean NOT NULL DEFAULT false,
  sort_order            int NOT NULL DEFAULT 0,
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Leave / mission requests (stage 3, extended in stage 5).
CREATE TABLE IF NOT EXISTS leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type_id       uuid REFERENCES leave_types(id),
  kind          text NOT NULL DEFAULT 'leave'
                  CHECK (kind IN ('leave','mission','hourly')),
  from_date     date NOT NULL,
  to_date       date NOT NULL,
  from_time     text,                            -- for hourly leave
  to_time       text,
  reason        text,
  attachment_url text,                           -- medical certificate, etc.
  effective_days numeric(6,2),                   -- computed billable days
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  current_step  int NOT NULL DEFAULT 1,
  total_steps   int NOT NULL DEFAULT 1,
  decided_by    uuid REFERENCES members(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Per-request approval chain (stage 5.3): one row per required approval level.
CREATE TABLE IF NOT EXISTS leave_approvals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  perm_key   text NOT NULL,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES members(id) ON DELETE SET NULL,
  decided_at timestamptz,
  note       text,
  UNIQUE (request_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_leave_member ON leave_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- Ledger module (double-entry foundation, extend later).
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'asset'
               CHECK (type IN ('asset','liability','equity','income','expense')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date  date NOT NULL DEFAULT current_date,
  description text,
  created_by  uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  debit      numeric(18,2) NOT NULL DEFAULT 0,
  credit     numeric(18,2) NOT NULL DEFAULT 0
);
`;
}
