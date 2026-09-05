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
import { DEFAULT_ACCOUNTS } from "../src/lib/coa";
import { ALL_MODULES } from "../src/lib/modules";
import { DEFAULT_LEAVE_TYPES } from "../src/lib/leave-types";
import { schemaNameFromSlug } from "../src/lib/utils";
import { todayJalali, toGregorian, isoDate, jalaliMonthLength } from "../src/lib/jalali";
import { fetchOfficialHolidays } from "../src/lib/online-holidays";
import { officialHolidaysFor } from "../src/lib/iran-holidays";
import { officialOccasionsFor } from "../src/lib/iran-events";

const CREDS = {
  superadmin: { email: process.env.SUPERADMIN_EMAIL ?? "admin@simorgh.local", password: process.env.SUPERADMIN_PASSWORD ?? "ChangeMe123!" },
  holding: { email: "holding@demo.local", password: "demo1234", name: "مدیر هولدینگ نمونه" },
  manager: { email: "manager@demo.local", password: "demo1234", name: "رضا آهنگرزاده", username: "reza" },
  hr: { email: "hr@demo.local", password: "demo1234", name: "مریم کارگزین", username: "maryam" },
  employee: { email: "employee@demo.local", password: "demo1234", name: "علی آهنگر", username: "ali" },
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
      INSERT INTO platform.holdings (name, slug, modules)
      VALUES ('هولدینگ صنعتی نمونه', 'holding-demo', ${ALL_MODULES})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, modules = EXCLUDED.modules
      RETURNING id
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
      console.log("→ demo section already exists — re-syncing holidays (corrected dates).");
      // Even on the skip path, refresh official days so legacy installs pick up
      // corrected religious dates (تاسوعا/عاشورا) without a full reseed.
      const jyNow = todayJalali().jy;
      for (const jy of [jyNow, jyNow + 1]) {
        const first = isoDate(toGregorian(jy, 1, 1));
        const last = isoDate(toGregorian(jy, 12, jalaliMonthLength(jy, 12)));
        await sql.unsafe(
          `DELETE FROM "${schema}".holidays
           WHERE is_official = true AND holiday_date BETWEEN '${first}' AND '${last}'`
        );
        for (const h of officialHolidaysFor(jy))
          await sql.unsafe(
            `INSERT INTO "${schema}".holidays (holiday_date, title, is_official, is_off)
             VALUES ($1, $2, true, true) ON CONFLICT (holiday_date) DO NOTHING`,
            [h.iso, h.title]
          );
        for (const o of officialOccasionsFor(jy))
          await sql.unsafe(
            `INSERT INTO "${schema}".holidays (holiday_date, title, is_official, is_off)
             VALUES ($1, $2, true, false) ON CONFLICT (holiday_date) DO NOTHING`,
            [o.iso, o.title]
          );
      }
      printCreds();
      return;
    }

    const [company] = await sql<{ id: string }[]>`
      INSERT INTO platform.companies (name, slug, schema_name, domain, holding_id, max_users, modules)
      VALUES ('بخش آهنگری', ${slug}, ${schema}, 'ahangari.simorghkara.ir', ${holding.id}, 50,
              ${ALL_MODULES})
      RETURNING id
    `;

    console.log("→ provisioning tenant schema:", schema);
    await sql.unsafe(tenantDDL(schema));

    // Section accounts (each with a company-scoped username for /c/<slug> login)
    const mgr = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, username, password_hash, full_name, company_id)
      VALUES (${CREDS.manager.email}, ${CREDS.manager.username}, ${await hash(CREDS.manager.password)}, ${CREDS.manager.name}, ${company.id}) RETURNING id`;
    const hr = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, username, password_hash, full_name, company_id)
      VALUES (${CREDS.hr.email}, ${CREDS.hr.username}, ${await hash(CREDS.hr.password)}, ${CREDS.hr.name}, ${company.id}) RETURNING id`;
    const emp = await sql<{ id: string }[]>`
      INSERT INTO platform.user_accounts (email, username, password_hash, full_name, company_id)
      VALUES (${CREDS.employee.email}, ${CREDS.employee.username}, ${await hash(CREDS.employee.password)}, ${CREDS.employee.name}, ${company.id}) RETURNING id`;

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
      // مدیر منابع انسانی/کارگزینی: تأیید مرحلهٔ کارگزینی + تقویم/شیفت + حضور و
      // دستگاه‌ها + مدیریت اعضا و نقش‌ها (دادن/کم‌وزیادکردن دسترسی افراد)
      for (const p of [
        'leave.approve.hr', 'calendar.view', 'calendar.manage', 'attendance.manage',
        'members.view', 'members.manage', 'roles.view', 'roles.manage',
        'groups.view', 'groups.manage',
      ])
        await tx`INSERT INTO role_permissions (role_id, permission_key) VALUES (${hrRole.id}, ${p})`;

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
            INSERT INTO holidays (holiday_date, title, is_official, is_off)
            VALUES (${h.iso}, ${h.title}, true, true)
            ON CONFLICT (holiday_date) DO NOTHING`;
        }
        // Informational occasions (مناسبت‌های غیرتعطیل).
        for (const o of officialOccasionsFor(jy)) {
          await tx`
            INSERT INTO holidays (holiday_date, title, is_official, is_off)
            VALUES (${o.iso}, ${o.title}, true, false)
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
      const hrId = await addMember(hr[0].id, CREDS.hr.name, "مسئول کارگزینی", "کارگزینی");
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

      // A personal kartabl note with a reminder (demonstrates the on-screen
      // popup, browser notification and «افزودن به تقویم» ICS export).
      const [ek] = await tx<{ id: string }[]>`SELECT id FROM kartabls WHERE member_id=${empId} ORDER BY created_at LIMIT 1`;
      await tx`
        INSERT INTO kartabl_items (kartabl_id, title, body, kind, created_by, remind_at)
        VALUES (${ek.id}, 'ارسال گزارش روزانه', 'نمونهٔ یادآوری — قابل افزودن به تقویم ویندوز/گوگل',
                'task', ${empId}, now() + interval '1 hour')`;

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

      /* ───────────────── مالی: سال مالی، کدینگ و یک سند قطعی ──────────── */
      const fyStart = isoDate(toGregorian(today.jy, 1, 1));
      const fyEnd = isoDate(toGregorian(today.jy, 12, jalaliMonthLength(today.jy, 12)));
      await tx`
        INSERT INTO fiscal_years (title, start_date, end_date, is_active)
        VALUES (${`سال مالی ${today.jy}`}, ${fyStart}, ${fyEnd}, true)`;
      const accountByCode = new Map<string, string>();
      for (const g of DEFAULT_ACCOUNTS) {
        const [parent] = await tx<{ id: string }[]>`
          INSERT INTO ledger_accounts (code, name, type, level, is_group)
          VALUES (${g.code}, ${g.name}, ${g.type}, 1, true) RETURNING id`;
        accountByCode.set(g.code, parent.id);
        for (const c of g.children) {
          const [child] = await tx<{ id: string }[]>`
            INSERT INTO ledger_accounts (code, name, type, level, is_group, parent_id)
            VALUES (${c.code}, ${c.name}, ${g.type}, 2, false, ${parent.id}) RETURNING id`;
          accountByCode.set(c.code, child.id);
        }
      }
      await tx`
        INSERT INTO parties (code, name, kind, phone)
        VALUES ('S-101', 'فولاد گستر پارس', 'supplier', '02133445566'),
               ('C-201', 'صنایع ماشین‌سازی آریا', 'customer', '02144556677')`;
      await tx`INSERT INTO cost_centers (code, name) VALUES ('CC-10', 'کارگاه آهنگری')`;
      // سند افتتاحیه: آوردهٔ نقدی سرمایه
      const [opening] = await tx<{ id: string }[]>`
        INSERT INTO ledger_entries (number, entry_date, description, created_by, status, posted_by, posted_at)
        VALUES (1, ${iso(1)}, 'سند افتتاحیه — آوردهٔ نقدی سرمایه', ${mgrId}, 'posted', ${mgrId}, now())
        RETURNING id`;
      await tx`
        INSERT INTO ledger_lines (entry_id, account_id, debit, credit, description, sort_order)
        VALUES (${opening.id}, ${accountByCode.get('102') ?? null}, 500000000, 0, 'واریز به حساب بانکی', 0),
               (${opening.id}, ${accountByCode.get('401') ?? null}, 0, 500000000, 'سرمایهٔ اولیه', 1)`;

      /* ─────────── انبار: انبار، کالا و یک رسید ورود تأییدشده ─────────── */
      const [wh] = await tx<{ id: string }[]>`
        INSERT INTO warehouses (code, name, location, manager_id)
        VALUES ('W1', 'انبار مرکزی', 'ضلع شمالی سالن', ${empId}) RETURNING id`;
      const [cat] = await tx<{ id: string }[]>`
        INSERT INTO item_categories (name) VALUES ('مواد اولیه') RETURNING id`;
      await tx`INSERT INTO item_categories (name) VALUES ('ایمنی و HSE'), ('قطعات یدکی')`;
      const [steel] = await tx<{ id: string }[]>`
        INSERT INTO items (code, name, category_id, unit, min_stock, last_price, account_id)
        VALUES ('IT-1001', 'شمش فولادی ST37', ${cat.id}, 'کیلوگرم', 500, 480000,
                ${accountByCode.get('104') ?? null}) RETURNING id`;
      const [glove] = await tx<{ id: string }[]>`
        INSERT INTO items (code, name, unit, min_stock, last_price)
        VALUES ('IT-2001', 'دستکش نسوز', 'جفت', 20, 950000) RETURNING id`;
      const [rcpt] = await tx<{ id: string }[]>`
        INSERT INTO stock_docs (number, kind, doc_date, warehouse_id, note, status,
                                created_by, approved_by, approved_at)
        VALUES (1, 'receipt', ${iso(d1)}, ${wh.id}, 'خرید مواد اولیهٔ ابتدای ماه',
                'approved', ${mgrId}, ${mgrId}, now()) RETURNING id`;
      await tx`
        INSERT INTO stock_doc_lines (doc_id, item_id, qty, unit_price, sort_order)
        VALUES (${rcpt.id}, ${steel.id}, 1200, 480000, 0),
               (${rcpt.id}, ${glove.id}, 15, 950000, 1)`;
      // یک درخواست کالای در انتظار تأیید تا گردش‌کار انبار دیده شود
      const [stockReq] = await tx<{ id: string }[]>`
        INSERT INTO stock_requests (number, requester_id, warehouse_id, needed_date, note)
        VALUES (1, ${empId}, ${wh.id}, ${iso(lv1)}, 'برای سفارش کارگاه') RETURNING id`;
      await tx`
        INSERT INTO stock_request_lines (request_id, item_id, qty)
        VALUES (${stockReq.id}, ${steel.id}, 300)`;

      /* ─────────── HRC: نقشه، ناحیه، ساعت هوشمند، تیم و قرائت ─────────── */
      await tx`INSERT INTO hrc_map (id, title) VALUES (1, 'نقشهٔ سایت آهنگری') ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO hrc_thresholds (id) VALUES (1) ON CONFLICT DO NOTHING`;
      const [zone] = await tx<{ id: string }[]>`
        INSERT INTO hrc_zones (name, kind, color, coord_mode, polygon, alert_on_enter, note)
        VALUES ('سالن کوره', 'hazard', '#ef4444', 'plan',
                ${tx.json([[20, 20], [60, 20], [60, 55], [20, 55]] as never)}, true,
                'دمای بالا — ورود با تجهیزات کامل') RETURNING id`;
      await tx`
        INSERT INTO hrc_zones (name, kind, color, coord_mode, polygon)
        VALUES ('محوطهٔ امن / نقطهٔ تجمع', 'muster', '#22c55e', 'plan',
                ${tx.json([[68, 62], [92, 62], [92, 88], [68, 88]] as never)})`;
      const [team] = await tx<{ id: string }[]>`
        INSERT INTO hrc_teams (name, kind, phone, radio_channel, base_location)
        VALUES ('تیم امداد شیفت روز', 'medical', '09120000000', 'CH-3', 'درمانگاه سایت')
        RETURNING id`;
      await tx`INSERT INTO hrc_team_members (team_id, member_id, team_role)
               VALUES (${team.id}, ${hrId}, 'سرپرست تیم')`;
      const [watch] = await tx<{ id: string }[]>`
        INSERT INTO hrc_devices (serial, token, model, kind, member_id, battery, last_seen)
        VALUES ('SK-W-1001', 'hrc_demo_token_ali', 'SimorghWatch S1', 'watch', ${empId}, 76, now())
        RETURNING id`;
      // یک قرائت سالم و یک قرائت هشداردار داخل سالن کوره
      await tx`
        INSERT INTO hrc_readings (member_id, device_id, recorded_at, heart_rate, spo2,
                                  body_temp, steps, battery, motion, x, y, source, zone_id)
        VALUES (${empId}, ${watch.id}, now() - interval '25 minutes', 74, 98, 36.6, 3120, 80,
                'walking', 35, 40, 'beacon', ${zone.id})`;
      const [hot] = await tx<{ id: string }[]>`
        INSERT INTO hrc_readings (member_id, device_id, recorded_at, heart_rate, spo2,
                                  body_temp, steps, battery, motion, x, y, source, zone_id)
        VALUES (${empId}, ${watch.id}, now() - interval '3 minutes', 148, 94, 38.9, 4980, 76,
                'still', 42, 46, 'beacon', ${zone.id})
        RETURNING id`;
      await tx`
        INSERT INTO hrc_alerts (member_id, device_id, reading_id, kind, severity, message, zone_id)
        VALUES (${empId}, ${watch.id}, ${hot.id}, 'temp_high', 'critical',
                'دمای بدن ۳۸.۹ بالاتر از حد مجاز (۳۸.۵) است.', ${zone.id}),
               (${empId}, ${watch.id}, ${hot.id}, 'heart_high', 'warn',
                'ضربان قلب ۱۴۸ بالاتر از حد مجاز (۱۴۰) است.', ${zone.id})`;
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
  console.log("کارمند (آهنگر)   : ", CREDS.employee.email, "/ demo1234  → مرخصی، حضور، دستیار، ساعت هوشمند HRC");
  console.log("پنل‌های فعال دمو : سازمان، منابع انسانی، مالی، انبار، HRC، API");
  console.log("توکن ساعت دمو    :  hrc_demo_token_ali  →  POST /api/aahangari-demo/hrc/ingest");
  console.log("───────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
