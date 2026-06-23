/**
 * Applies incremental schema changes to every existing tenant schema.
 * Idempotent — safe to run repeatedly. Run with:  npm run db:migrate
 */
import postgres from "postgres";
import { ALL_PERMISSIONS } from "../src/lib/rbac";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
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
      `);
      await sql.unsafe(`
        INSERT INTO "${schema_name}".attendance_policy (id) VALUES (1)
        ON CONFLICT DO NOTHING;
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
