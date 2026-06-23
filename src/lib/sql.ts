/**
 * DDL for the control-plane (`platform`) schema and the per-tenant schema
 * template. Kept as plain SQL strings so they can be applied idempotently
 * during seeding and tenant provisioning.
 */

export const PLATFORM_DDL = /* sql */ `
CREATE SCHEMA IF NOT EXISTS platform;
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;          -- case-insensitive email

-- Companies = tenants. Each has its own dedicated schema.
CREATE TABLE IF NOT EXISTS platform.companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  schema_name  text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','pending')),
  plan         text NOT NULL DEFAULT 'standard',
  max_users    integer NOT NULL DEFAULT 10,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Global identity / auth records. Used to resolve which tenant a login
-- belongs to. Platform super-admins have company_id = NULL.
CREATE TABLE IF NOT EXISTS platform.user_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  full_name          text NOT NULL,
  is_platform_admin  boolean NOT NULL DEFAULT false,
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
                CHECK (kind IN ('task','document','message')),
  status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','done','archived')),
  -- The member who created/assigned this item. Only the assigner (or a
  -- kartabl manager acting on someone else's kartabl) may edit or delete it;
  -- the recipient can only report progress via status. This keeps tasks
  -- assigned to a person — even the CEO — tamper-proof for accountability.
  created_by  uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kartabl_items_kartabl ON kartabl_items(kartabl_id);

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
  created_at   timestamptz NOT NULL DEFAULT now()
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
  source     text NOT NULL DEFAULT 'self',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_punch_member_time
  ON attendance_punches(member_id, punched_at);

-- Attendance policy / company rules (stage 3): single settings row.
CREATE TABLE IF NOT EXISTS attendance_policy (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  grace_minutes          int NOT NULL DEFAULT 0,        -- allowed lateness
  standard_daily_minutes int NOT NULL DEFAULT 480,      -- 8h working day
  monthly_leave_days     numeric(5,1) NOT NULL DEFAULT 2.5,
  annual_leave_days      numeric(5,1) NOT NULL DEFAULT 26,
  overtime_enabled       boolean NOT NULL DEFAULT true
);

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
  decided_by    uuid REFERENCES members(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
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
