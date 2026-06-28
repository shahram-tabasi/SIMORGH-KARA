/**
 * Applies incremental schema changes to every existing tenant schema.
 * Idempotent — safe to run repeatedly. Run with:  npm run db:migrate
 */
import postgres from "postgres";
import { ALL_PERMISSIONS } from "../src/lib/rbac";
import { DEFAULT_LEAVE_TYPES } from "../src/lib/leave-types";
import { officialHolidaysFor } from "../src/lib/iran-holidays";
import { officialOccasionsFor } from "../src/lib/iran-events";
import { todayJalali, toGregorian, isoDate, jalaliMonthLength } from "../src/lib/jalali";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Control-plane (platform) migrations: holdings + holding admins.
    console.log("→ migrating platform");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS platform.holdings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE platform.companies
        ADD COLUMN IF NOT EXISTS holding_id uuid REFERENCES platform.holdings(id) ON DELETE SET NULL;
      ALTER TABLE platform.holdings
        ADD COLUMN IF NOT EXISTS max_companies int NOT NULL DEFAULT 1;
      ALTER TABLE platform.user_accounts
        ADD COLUMN IF NOT EXISTS is_holding_admin boolean NOT NULL DEFAULT false;
      ALTER TABLE platform.user_accounts
        ADD COLUMN IF NOT EXISTS holding_id uuid REFERENCES platform.holdings(id) ON DELETE CASCADE;
    `);

    const tenants = await sql<{ schema_name: string }[]>`
      SELECT schema_name FROM platform.companies
    `;
    for (const { schema_name } of tenants) {
      if (!/^tenant_[a-z0-9_]+$/.test(schema_name)) continue;
      console.log("→ migrating", schema_name);

      // kartabl_items.created_by — assigner tracking for the accountability model
      await sql.unsafe(`
        ALTER TABLE "${schema_name}".kartabl_items
          ADD COLUMN IF NOT EXISTS created_by uuid
          REFERENCES "${schema_name}".members(id) ON DELETE SET NULL;
      `);
      // Backfill existing self-created items so their owner can still edit them.
      await sql.unsafe(`
        UPDATE "${schema_name}".kartabl_items i
        SET created_by = k.member_id
        FROM "${schema_name}".kartabls k
        WHERE i.kartabl_id = k.id AND i.created_by IS NULL;
      `);

      // HR / Calendar module (stage 1)
      await sql.unsafe(`
        ALTER TABLE "${schema_name}".members
          ADD COLUMN IF NOT EXISTS schedule_id uuid;

        CREATE TABLE IF NOT EXISTS "${schema_name}".work_schedules (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          work_days int[] NOT NULL DEFAULT '{0,1,2,3,4}',
          start_time text NOT NULL DEFAULT '08:00',
          end_time text NOT NULL DEFAULT '17:00',
          is_default boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "${schema_name}".holidays (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          holiday_date date NOT NULL UNIQUE,
          title text NOT NULL,
          is_official boolean NOT NULL DEFAULT true,
          is_off boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE "${schema_name}".holidays
          ADD COLUMN IF NOT EXISTS is_off boolean NOT NULL DEFAULT true;

        CREATE TABLE IF NOT EXISTS "${schema_name}".schedule_overrides (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          override_date date NOT NULL UNIQUE,
          is_working boolean NOT NULL,
          note text,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "${schema_name}".attendance_days (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          work_date date NOT NULL,
          check_in timestamptz,
          check_out timestamptz,
          note text,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (member_id, work_date)
        );
        CREATE INDEX IF NOT EXISTS idx_attendance_date
          ON "${schema_name}".attendance_days(work_date);

        CREATE TABLE IF NOT EXISTS "${schema_name}".attendance_punches (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          punched_at timestamptz NOT NULL DEFAULT now(),
          kind text NOT NULL CHECK (kind IN ('in','out')),
          source text NOT NULL DEFAULT 'self',
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_punch_member_time
          ON "${schema_name}".attendance_punches(member_id, punched_at);

        CREATE TABLE IF NOT EXISTS "${schema_name}".attendance_policy (
          id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          grace_minutes int NOT NULL DEFAULT 0,
          standard_daily_minutes int NOT NULL DEFAULT 480,
          monthly_leave_days numeric(5,1) NOT NULL DEFAULT 2.5,
          annual_leave_days numeric(5,1) NOT NULL DEFAULT 26,
          overtime_enabled boolean NOT NULL DEFAULT true
        );

        CREATE TABLE IF NOT EXISTS "${schema_name}".leave_requests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          kind text NOT NULL DEFAULT 'leave' CHECK (kind IN ('leave','mission','hourly')),
          from_date date NOT NULL,
          to_date date NOT NULL,
          from_time text,
          to_time text,
          reason text,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          decided_by uuid REFERENCES "${schema_name}".members(id) ON DELETE SET NULL,
          decided_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_leave_member ON "${schema_name}".leave_requests(member_id);
        CREATE INDEX IF NOT EXISTS idx_leave_status ON "${schema_name}".leave_requests(status);

        CREATE TABLE IF NOT EXISTS "${schema_name}".member_employment (
          member_id uuid PRIMARY KEY REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          hire_date date NOT NULL DEFAULT current_date,
          site text NOT NULL DEFAULT 'hq' CHECK (site IN ('hq','factory','guard')),
          daily_work_minutes int NOT NULL DEFAULT 510,
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "${schema_name}".leave_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          jyear int NOT NULL,
          kind text NOT NULL CHECK (kind IN ('carry_in','forfeit','buyback','adjust')),
          days numeric(6,2) NOT NULL,
          note text,
          created_by uuid REFERENCES "${schema_name}".members(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_leave_ledger_member
          ON "${schema_name}".leave_ledger(member_id, jyear);

        CREATE TABLE IF NOT EXISTS "${schema_name}".leave_types (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          name text NOT NULL,
          unit text NOT NULL DEFAULT 'day' CHECK (unit IN ('day','hour')),
          paid boolean NOT NULL DEFAULT true,
          deducts_entitlement boolean NOT NULL DEFAULT true,
          counts_inner_holidays boolean NOT NULL DEFAULT false,
          requires_attachment boolean NOT NULL DEFAULT false,
          max_minutes_per_day int,
          max_count_per_month int,
          max_count_per_week int,
          max_days_per_year numeric(6,1),
          approval_levels int NOT NULL DEFAULT 1,
          is_active boolean NOT NULL DEFAULT true,
          is_system boolean NOT NULL DEFAULT false,
          sort_order int NOT NULL DEFAULT 0,
          description text,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE "${schema_name}".leave_requests
          ADD COLUMN IF NOT EXISTS type_id uuid REFERENCES "${schema_name}".leave_types(id),
          ADD COLUMN IF NOT EXISTS attachment_url text,
          ADD COLUMN IF NOT EXISTS details jsonb,
          ADD COLUMN IF NOT EXISTS effective_days numeric(6,2),
          ADD COLUMN IF NOT EXISTS current_step int NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS total_steps int NOT NULL DEFAULT 1;

        CREATE TABLE IF NOT EXISTS "${schema_name}".leave_approvals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          request_id uuid NOT NULL REFERENCES "${schema_name}".leave_requests(id) ON DELETE CASCADE,
          step_order int NOT NULL,
          perm_key text NOT NULL,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          decided_by uuid REFERENCES "${schema_name}".members(id) ON DELETE SET NULL,
          decided_at timestamptz,
          note text,
          UNIQUE (request_id, step_order)
        );

        UPDATE "${schema_name}".attendance_policy
          SET annual_leave_days = 30 WHERE annual_leave_days = 26;
      `);

      // «میز کار» — team tasks / work orders.
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS "${schema_name}".work_tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          body text,
          code text,
          priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','forced')),
          from_date date,
          due_date date,
          created_by uuid REFERENCES "${schema_name}".members(id) ON DELETE SET NULL,
          group_id uuid REFERENCES "${schema_name}".groups(id) ON DELETE SET NULL,
          parent_id uuid REFERENCES "${schema_name}".work_tasks(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS "${schema_name}".work_task_assignees (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id uuid NOT NULL REFERENCES "${schema_name}".work_tasks(id) ON DELETE CASCADE,
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (task_id, member_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_assignee_member ON "${schema_name}".work_task_assignees(member_id);
        CREATE INDEX IF NOT EXISTS idx_work_tasks_creator ON "${schema_name}".work_tasks(created_by);
        ALTER TABLE "${schema_name}".work_task_assignees
          ADD COLUMN IF NOT EXISTS delegated_from uuid
          REFERENCES "${schema_name}".members(id) ON DELETE SET NULL;
        ALTER TABLE "${schema_name}".work_task_assignees
          ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
      `);

      // Kartabl approval items: link to a leave request + new 'approval' kind.
      await sql.unsafe(`
        ALTER TABLE "${schema_name}".kartabl_items
          ADD COLUMN IF NOT EXISTS ref_kind text,
          ADD COLUMN IF NOT EXISTS ref_id uuid;
        ALTER TABLE "${schema_name}".kartabl_items
          DROP CONSTRAINT IF EXISTS kartabl_items_kind_check;
        ALTER TABLE "${schema_name}".kartabl_items
          ADD CONSTRAINT kartabl_items_kind_check
          CHECK (kind IN ('task','document','message','approval'));
        ALTER TABLE "${schema_name}".kartabl_items
          ADD COLUMN IF NOT EXISTS remind_at timestamptz;
        UPDATE "${schema_name}".leave_types
          SET approval_levels = 2 WHERE approval_levels < 2;
      `);

      // Backfill an employment profile for every existing member.
      await sql.unsafe(`
        INSERT INTO "${schema_name}".member_employment (member_id, hire_date)
        SELECT id, created_at::date FROM "${schema_name}".members
        ON CONFLICT (member_id) DO NOTHING;
      `);

      // Seed/refresh the leave-type catalogue (system types only; never clobber
      // a company's own edits — insert missing ones by code).
      for (const t of DEFAULT_LEAVE_TYPES) {
        await sql.unsafe(
          `INSERT INTO "${schema_name}".leave_types
            (code, name, unit, paid, deducts_entitlement, counts_inner_holidays,
             requires_attachment, max_minutes_per_day, max_count_per_month,
             max_count_per_week, max_days_per_year, approval_levels, sort_order,
             description, is_system)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
           ON CONFLICT (code) DO NOTHING`,
          [
            t.code, t.name, t.unit, t.paid, t.deducts_entitlement,
            t.counts_inner_holidays, t.requires_attachment, t.max_minutes_per_day,
            t.max_count_per_month, t.max_count_per_week, t.max_days_per_year,
            t.approval_levels, t.sort_order, t.description,
          ]
        );
      }
      await sql.unsafe(`
        INSERT INTO "${schema_name}".attendance_policy (id) VALUES (1)
        ON CONFLICT DO NOTHING;
        ALTER TABLE "${schema_name}".attendance_policy
          ADD COLUMN IF NOT EXISTS max_punches_per_week int NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS max_punches_per_month int NOT NULL DEFAULT 0;
        ALTER TABLE "${schema_name}".attendance_punches
          ADD COLUMN IF NOT EXISTS photo_url text,
          ADD COLUMN IF NOT EXISTS lat double precision,
          ADD COLUMN IF NOT EXISTS lng double precision;
        CREATE TABLE IF NOT EXISTS "${schema_name}".attendance_devices (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          token text NOT NULL UNIQUE,
          kind text NOT NULL DEFAULT 'terminal' CHECK (kind IN ('terminal','guard','mobile')),
          is_active boolean NOT NULL DEFAULT true,
          last_seen timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS "${schema_name}".face_embeddings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES "${schema_name}".members(id) ON DELETE CASCADE,
          vec jsonb NOT NULL,
          dim int NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_face_member ON "${schema_name}".face_embeddings(member_id);
      `);
      // Seed a default schedule if the company has none yet.
      await sql.unsafe(`
        INSERT INTO "${schema_name}".work_schedules
          (name, work_days, start_time, end_time, is_default)
        SELECT 'شیفت اداری', '{0,1,2,3,4}', '08:00', '17:00', true
        WHERE NOT EXISTS (SELECT 1 FROM "${schema_name}".work_schedules);
      `);

      // Grant any newly-added permission keys to the full-access system role
      // ("مدیر سامانه") so existing admins gain new capabilities automatically.
      const [adminRole] = await sql.unsafe(
        `SELECT id FROM "${schema_name}".roles
         WHERE is_system = true AND name = 'مدیر سامانه' LIMIT 1`
      );
      if (adminRole) {
        for (const key of ALL_PERMISSIONS) {
          await sql.unsafe(
            `INSERT INTO "${schema_name}".role_permissions (role_id, permission_key)
             VALUES ('${adminRole.id}', '${key}')
             ON CONFLICT DO NOTHING`
          );
        }
      }

      // Re-sync official days for current + next Jalali year from the corrected
      // offline computation (deterministic, network-free). This fixes legacy
      // data where religious dates were a day off (e.g. تاسوعا/عاشورا). Company
      // -added custom days (is_official = false) are preserved.
      const jyNow = todayJalali().jy;
      for (const jy of [jyNow, jyNow + 1]) {
        const first = isoDate(toGregorian(jy, 1, 1));
        const last = isoDate(toGregorian(jy, 12, jalaliMonthLength(jy, 12)));
        await sql.unsafe(
          `DELETE FROM "${schema_name}".holidays
           WHERE is_official = true AND holiday_date BETWEEN '${first}' AND '${last}'`
        );
        for (const h of officialHolidaysFor(jy)) {
          await sql.unsafe(
            `INSERT INTO "${schema_name}".holidays (holiday_date, title, is_official, is_off)
             VALUES ($1, $2, true, true) ON CONFLICT (holiday_date) DO NOTHING`,
            [h.iso, h.title]
          );
        }
        for (const o of officialOccasionsFor(jy)) {
          await sql.unsafe(
            `INSERT INTO "${schema_name}".holidays (holiday_date, title, is_official, is_off)
             VALUES ($1, $2, true, false) ON CONFLICT (holiday_date) DO NOTHING`,
            [o.iso, o.title]
          );
        }
      }
    }
    console.log("✔ Migration complete.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
