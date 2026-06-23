/**
 * Seeds a ready-to-explore demo: a holding with one section company
 * (آهنگری), a section manager, an HR officer (کارگزینی) and an employee,
 * plus sample attendance and a pending leave request sitting in the
 * manager's kartabl. Run with:  npm run db:demo   (idempotent)
 */
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PLATFORM_DDL, tenantDDL } from "../src/lib/sql";
import { DEFAULT_ROLES, ALL_PERMISSIONS } from "../src/lib/rbac";
import { DEFAULT_LEAVE_TYPES } from "../src/lib/leave-types";
import { schemaNameFromSlug } from "../src/lib/utils";
import { todayJalali, toGregorian, isoDate } from "../src/lib/jalali";
import { fetchOfficialHolidays } from "../src/lib/online-holidays";

const CREDS = {
  superadmin: { email: process.env.SUPERADMIN_EMAIL ?? "admin@simorgh.local", password: process.env.SUPERADMIN_PASSWORD ?? "ChangeMe123!" },
  holding: { email: "holding@demo.local", password: "demo1234", name: "مدیر هولدینگ نمونه" },
  manager: { email: "manager@demo.local", password: "demo1234", name: "رضا آهنگرزاده" },
  hr: { email: "hr@demo.local", password: "demo1234", name: "مریم کارگزین" },
  employee: { email: "employee@demo.local", password: "demo1234", name: "علی آهنگر" },
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const hash = (p: string) => bcrypt.hash(p, 10);

  try {
    console.log("→ platform schema…");
    await sql.unsafe(PLATFORM_DDL);
    // Defensive: ensure holding columns exist on older installs.
    await sql.unsafe(`
      ALTER TABLE platform.user_accounts ADD COLUMN IF NOT EXISTS is_holding_admin boolean NOT NULL DEFAULT false;
      ALTER TABLE platform.user_accounts ADD COLUMN IF NOT EXISTS holding_id uuid REFERENCES platform.holdings(id) ON DELETE CASCADE;
      ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS holding_id uuid REFERENCES platform.holdings(id) ON DELETE SET NULL;
    `);

    // Super admin
    await sql`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, is_platform_admin)
      VALUES (${CREDS.superadmin.email}, ${await hash(CREDS.superadmin.password)}, 'مدیر سیمرغ', true)
      ON CONFLICT (email) DO UPDATE SET is_platform_admin = true
    `;

    // Holding + holding admin
    const [holding] = await sql<{ id: string }[]>`
      INSERT INTO platform.holdings (name, slug) VALUES ('هولدینگ صنعتی نمونه', 'holding-demo')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `;
    await sql`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, is_holding_admin, holding_id)
      VALUES (${CREDS.holding.email}, ${await hash(CREDS.holding.password)}, ${CREDS.holding.name}, true, ${holding.id})
      ON CONFLICT (email) DO UPDATE SET is_holding_admin = true, holding_id = ${holding.id}
    `;

    // Section company (آهنگری) under the holding
    const slug = "aahangari-demo";
    const schema = schemaNameFromSlug(slug);
    const [existing] = await sql`SELECT id FROM platform.companies WHERE slug = ${slug}`;
    if (existing) {
      console.log("→ demo section already exists — skipping (credentials below).");
      printCreds();
      return;
    }

    const [company] = await sql<{ id: string }[]>`
      INSERT INTO platform.companies (name, slug, schema_name, holding_id, max_users)
      VALUES ('بخش آهنگری', ${slug}, ${schema}, ${holding.id}, 50) RETURNING id
    `;

    console.log("→ provisioning tenant schema:", schema);
    await sql.unsafe(tenantDDL(schema));

    // Section accounts
    const mgr = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id)
      VALUES (${CREDS.manager.email}, ${await hash(CREDS.manager.password)}, ${CREDS.manager.name}, ${company.id}) RETURNING id`;
    const hr = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id)
      VALUES (${CREDS.hr.email}, ${await hash(CREDS.hr.password)}, ${CREDS.hr.name}, ${company.id}) RETURNING id`;
    const emp = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id)
      VALUES (${CREDS.employee.email}, ${await hash(CREDS.employee.password)}, ${CREDS.employee.name}, ${company.id}) RETURNING id`;

    const today = todayJalali();
    const iso = (d: number) => isoDate(toGregorian(today.jy, today.jm, d));
    // attendance on the last two days up to today; leave a few days ahead
    const d1 = Math.max(1, today.jd - 1);
    const d2 = Math.max(1, today.jd);
    const lv1 = Math.min(28, today.jd + 4);
    const lv2 = Math.min(28, today.jd + 5);

    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${schema}", platform, public`);

      // Roles: defaults + a کارگزینی role
      const roleId = new Map<string, string>();
      for (const r of DEFAULT_ROLES) {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO roles (name, description, is_system) VALUES (${r.name}, ${r.description}, ${r.is_system}) RETURNING id`;
        roleId.set(r.name, row.id);
        for (const p of r.permissions)
          await tx`INSERT INTO role_permissions (role_id, permission_key) VALUES (${row.id}, ${p})`;
      }
      const [hrRole] = await tx<{ id: string }[]>`
        INSERT INTO roles (name, description) VALUES ('کارگزینی', 'تأیید مرخصی در مرحله کارگزینی') RETURNING id`;
      await tx`INSERT INTO role_permissions (role_id, permission_key) VALUES (${hrRole.id}, 'leave.approve.hr')`;

      // Default schedule + policy + leave types
      await tx`INSERT INTO work_schedules (name, work_days, start_time, end_time, is_default) VALUES ('شیفت اداری', '{0,1,2,3,4}', '08:00', '17:00', true)`;
      await tx`INSERT INTO attendance_policy (id, annual_leave_days) VALUES (1, 30) ON CONFLICT DO NOTHING`;

      // Official Iranian holidays for this and next Jalali year, read online
      // (so تاسوعا/عاشورا and the rest show up by name in the calendar and the
      // attendance sheet); falls back to the offline computation if offline.
      for (const jy of [today.jy, today.jy + 1]) {
        const { holidays, source } = await fetchOfficialHolidays(jy);
        console.log(`  holidays ${jy}: ${holidays.length} (${source})`);
        for (const h of holidays) {
          await tx`
            INSERT INTO holidays (holiday_date, title, is_official)
            VALUES (${h.iso}, ${h.title}, true)
            ON CONFLICT (holiday_date) DO NOTHING`;
        }
      }
      for (const t of DEFAULT_LEAVE_TYPES) {
        await tx`
          INSERT INTO leave_types (code, name, unit, paid, deducts_entitlement, counts_inner_holidays,
            requires_attachment, max_minutes_per_day, max_count_per_month, max_count_per_week,
            max_days_per_year, approval_levels, sort_order, description, is_system)
          VALUES (${t.code}, ${t.name}, ${t.unit}, ${t.paid}, ${t.deducts_entitlement}, ${t.counts_inner_holidays},
            ${t.requires_attachment}, ${t.max_minutes_per_day}, ${t.max_count_per_month}, ${t.max_count_per_week},
            ${t.max_days_per_year}, ${t.approval_levels}, ${t.sort_order}, ${t.description}, true)`;
      }

      // Members
      async function addMember(accountId: string, name: string, title: string, role: string) {
        const [m] = await tx<{ id: string }[]>`
          INSERT INTO members (account_id, full_name, title) VALUES (${accountId}, ${name}, ${title}) RETURNING id`;
        await tx`INSERT INTO member_roles (member_id, role_id) VALUES (${m.id}, ${roleId.get(role) ?? hrRole.id})`;
        await tx`INSERT INTO kartabls (member_id, name) VALUES (${m.id}, 'کارتابل اصلی')`;
        await tx`INSERT INTO member_employment (member_id, hire_date, site, daily_work_minutes) VALUES (${m.id}, '2024-03-20', 'factory', 440)`;
        return m.id;
      }
      const mgrId = await addMember(mgr[0].id, CREDS.manager.name, "مدیر بخش", "مدیر سامانه");
      await tx`INSERT INTO member_roles (member_id, role_id)
               SELECT ${mgrId}, id FROM roles WHERE name='کارگزینی' ON CONFLICT DO NOTHING`; // manager can also act as HR for the demo
      await addMember(hr[0].id, CREDS.hr.name, "مسئول کارگزینی", "کارگزینی");
      const empId = await addMember(emp[0].id, CREDS.employee.name, "آهنگر", "کاربر");

      // Sample attendance for the employee (a normal day + a late day)
      const punch = (d: number, t: string, k: string) =>
        tx`INSERT INTO attendance_punches (member_id, punched_at, kind) VALUES (${empId}, ${`${iso(d)} ${t}`}, ${k})`;
      await punch(d1, "08:00", "in"); await punch(d1, "17:00", "out");   // full day + hourly leave window below
      await punch(d2, "08:40", "in"); await punch(d2, "15:00", "out");   // late + short → deficit

      // Approved مرخصی ساعتی on d1 (11:00–12:00) → timeline shows ۸:۰۰ ۱۱:۰۰ ۱۲:۰۰ ۱۷:۰۰
      await tx`
        INSERT INTO leave_requests (member_id, type_id, kind, from_date, to_date, from_time, to_time, status, effective_days, total_steps, current_step)
        VALUES (${empId}, (SELECT id FROM leave_types WHERE code='entitlement_hourly'), 'hourly', ${iso(d1)}, ${iso(d1)}, '11:00', '12:00', 'approved', 0.12, 2, 2)`;

      // A pending leave request from the employee → lands in the manager's kartabl
      const [req] = await tx<{ id: string }[]>`
        INSERT INTO leave_requests (member_id, type_id, kind, from_date, to_date, status, effective_days, total_steps, current_step)
        VALUES (${empId}, (SELECT id FROM leave_types WHERE code='entitlement_daily'), 'leave', ${iso(lv1)}, ${iso(lv2)}, 'pending', 2, 2, 1)
        RETURNING id`;
      await tx`INSERT INTO leave_approvals (request_id, step_order, perm_key) VALUES (${req.id}, 1, 'leave.approve'), (${req.id}, 2, 'leave.approve.hr')`;
      const [mk] = await tx<{ id: string }[]>`SELECT id FROM kartabls WHERE member_id=${mgrId} ORDER BY created_at LIMIT 1`;
      await tx`INSERT INTO kartabl_items (kartabl_id, title, body, kind, ref_kind, ref_id, created_by)
               VALUES (${mk.id}, ${`درخواست مرخصی: ${CREDS.employee.name}`}, 'مرحله مدیر بخش', 'approval', 'leave_request', ${req.id}, ${empId})`;

      // The manager's *own* in-flight leave (so «کارتابل مرخصی» shows both their
      // approval queue and their own pending requests).
      await tx`
        INSERT INTO leave_requests (member_id, type_id, kind, from_date, to_date, status, reason, effective_days, total_steps, current_step)
        VALUES (${mgrId}, (SELECT id FROM leave_types WHERE code='entitlement_daily'), 'leave', ${iso(lv1)}, ${iso(lv1)}, 'pending', 'مرخصی شخصی', 1, 2, 2)`;

      // Sample «میز کار» tasks from the manager to the employee
      const [wt1] = await tx<{ id: string }[]>`
        INSERT INTO work_tasks (title, code, body, priority, due_date, created_by)
        VALUES ('وایرینگ تابلو', '110234', 'سیم‌کشی تابلو طبق نقشه', 'urgent', ${iso(lv1)}, ${mgrId}) RETURNING id`;
      await tx`INSERT INTO work_task_assignees (task_id, member_id) VALUES (${wt1.id}, ${empId})`;
      const [wt2] = await tx<{ id: string }[]>`
        INSERT INTO work_tasks (title, code, body, priority, due_date, created_by)
        VALUES ('بازرسی ایمنی کوره', 'SAFE-9', 'بازرسی فوری ایمنی', 'forced', ${iso(d2)}, ${mgrId}) RETURNING id`;
      await tx`INSERT INTO work_task_assignees (task_id, member_id) VALUES (${wt2.id}, ${empId})`;
    });

    console.log("✔ Demo ready.");
    printCreds();
  } finally {
    await sql.end();
  }
}

function printCreds() {
  console.log("\n──────── دسترسی‌های دمو (رمز همه: demo1234) ────────");
  console.log("سوپرادمین پلتفرم : ", CREDS.superadmin.email, "/", CREDS.superadmin.password, " → /admin");
  console.log("مدیر هولدینگ     : ", CREDS.holding.email, "/ demo1234  → /holding");
  console.log("مدیر بخش آهنگری  : ", CREDS.manager.email, "/ demo1234  → /app/aahangari-demo (کارتابل = درخواست مرخصی منتظر تأیید)");
  console.log("مسئول کارگزینی   : ", CREDS.hr.email, "/ demo1234");
  console.log("کارمند (آهنگر)   : ", CREDS.employee.email, "/ demo1234  → مرخصی، حضور، دستیار");
  console.log("───────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
