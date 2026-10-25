// A company's starting organisation in Kara: its units (Kara's groups, Odoo's
// departments) and what it makes (knowledge items of kind product), so a new
// company does not begin empty. Only what is missing is added — a unit by
// name under the same parent, a product by its code — and nothing is changed
// or removed, so the company's own edits stand. The company's provisioning
// job then carries both into Odoo (a department already there by the same
// name is taken over, not doubled).
//
// EKC's set mirrors simorgh-odoo deploy/scripts/seed-ekc.py (its
// departments, the same names) — change both together.

import type { DbService } from '../infra/db.service';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

interface Unit { name: string; parent?: string }
interface Product { code: string; name: string; summary: string; features: Record<string, string | number> }
interface OrgSet { units: Unit[]; products: Product[] }

const EKC: OrgSet = {
  units: [
    { name: 'مدیریت عامل' },
    { name: 'دفتر مدیریت سیستم‌ها و تضمین کیفیت', parent: 'مدیریت عامل' },
    { name: 'ایمنی، بهداشت و محیط زیست', parent: 'مدیریت عامل' },
    { name: 'معاونت فروش و بازاریابی' },
    { name: 'مناقصات و برآورد', parent: 'معاونت فروش و بازاریابی' },
    { name: 'فروش و ارتباط با مشتریان', parent: 'معاونت فروش و بازاریابی' },
    { name: 'معاونت مهندسی' },
    { name: 'طراحی برق', parent: 'معاونت مهندسی' },
    { name: 'طراحی مکانیک', parent: 'معاونت مهندسی' },
    { name: 'مستندات فنی', parent: 'معاونت مهندسی' },
    { name: 'معاونت بازرگانی و تأمین' },
    { name: 'خرید داخلی', parent: 'معاونت بازرگانی و تأمین' },
    { name: 'خرید خارجی و ترخیص', parent: 'معاونت بازرگانی و تأمین' },
    { name: 'انبار', parent: 'معاونت بازرگانی و تأمین' },
    { name: 'معاونت تولید' },
    { name: 'برنامه‌ریزی و کنترل تولید', parent: 'معاونت تولید' },
    { name: 'ساخت بدنه و ورق‌کاری', parent: 'معاونت تولید' },
    { name: 'رنگ', parent: 'معاونت تولید' },
    { name: 'شینه‌کاری', parent: 'معاونت تولید' },
    { name: 'مونتاژ و سیم‌کشی فشار ضعیف', parent: 'معاونت تولید' },
    { name: 'مونتاژ فشار متوسط', parent: 'معاونت تولید' },
    { name: 'نگهداری و تعمیرات', parent: 'معاونت تولید' },
    { name: 'کنترل کیفیت و آزمون' },
    { name: 'مدیریت پروژه' },
    { name: 'خدمات پس از فروش و راه‌اندازی' },
    { name: 'مالی و حسابداری' },
    { name: 'منابع انسانی و امور اداری' },
    { name: 'فناوری اطلاعات' },
  ],
  products: [
    {
      code: 'EKC-LV-S8', name: 'تابلو فشار ضعیف بر پایهٔ SIVACON S8',
      summary: 'تابلوهای اصلی توزیع و فیدر فشار ضعیف با کلیدهای هوایی SENTRON 3WA و کامپکت 3VA زیمنس، ساخته‌شده با مجوز زیمنس و آزموده مطابق IEC 61439-1/2.',
      features: { 'استاندارد': 'IEC 61439-1/2', 'جریان نامی شینهٔ اصلی': 'تا 4000 A', 'کلید ورودی': 'SENTRON 3WA', 'فیدرها': 'SENTRON 3VA', 'آزمون': 'آزمون روتین بند 11 در کارخانه' },
    },
    {
      code: 'EKC-MCC', name: 'مرکز کنترل موتور (MCC)',
      summary: 'سلول‌های MCC با تجهیزات SIRIUS زیمنس (کلید حفاظت موتور 3RV، کنتاکتور 3RT، سافت‌استارتر 3RW) برای صنایع نفت، گاز، پتروشیمی و آب.',
      features: { 'استاندارد': 'IEC 61439-1/2', 'تجهیزات': 'SIRIUS 3RV / 3RT / 3RW', 'نوع ماژول': 'ثابت یا کشویی' },
    },
    {
      code: 'EKC-MV-24', name: 'تابلو فشار متوسط هوایی 24 کیلوولت',
      summary: 'سلول‌های ورودی، فیدر و اندازه‌گیری فشار متوسط با کلید خلأ 3AE / 3AH5 و رلهٔ حفاظتی SIPROTEC / Reyrolle زیمنس، آزموده مطابق IEC 62271-200.',
      features: { 'استاندارد': 'IEC 62271-200', 'ولتاژ نامی': 'تا 24 kV', 'کلید قدرت': 'کلید خلأ زیمنس 3AE / 3AH5', 'حفاظت': 'SIPROTEC 5 / Reyrolle 7SR' },
    },
    {
      code: 'EKC-RMU', name: 'رینگ‌مین‌یونیت 8DJH (تأمین و تحویل)',
      summary: 'تأمین رینگ‌مین‌یونیت گازی 8DJH زیمنس برای شبکه‌های توزیع، همراه نصب و راه‌اندازی.',
      features: { 'سازنده': 'Siemens', 'نوع': 'عایق گازی، ثانویه' },
    },
    {
      code: 'EKC-SVC', name: 'خدمات مهندسی، آزمون و راه‌اندازی',
      summary: 'طراحی برق و مکانیک تابلو (EPLAN)، آزمون پذیرش کارخانه‌ای با حضور مشتری، راه‌اندازی و آزمون در محل، آموزش بهره‌برداری و تأمین قطعات یدکی.',
      features: { 'طراحی': 'EPLAN', 'آزمون': 'FAT / SAT' },
    },
  ],
};

const SETS: Record<string, OrgSet> = { ekc: EKC };

export async function seedOrg(db: DbService, slug: string, o: { dryRun: boolean }): Promise<string[]> {
  const set = SETS[slug];
  if (!set) throw new Error(`no organisation set for "${slug}" (known: ${Object.keys(SETS).join(', ')})`);
  const [company] = await db.query<{ id: string; schema: string }>(`SELECT id::text, schema_name AS schema FROM platform.companies WHERE slug = $1`, [slug]);
  if (!company) throw new Error(`no Kara company "${slug}"`);
  if (!SCHEMA_RE.test(company.schema)) throw new Error(`unexpected schema ${company.schema}`);
  const s = company.schema;
  const out: string[] = [];
  let made = 0;

  await db.tx(async (c) => {
    const idOf = new Map<string, string>();
    for (const u of set.units) {
      const parentId = u.parent ? idOf.get(u.parent) ?? null : null;
      if (u.parent && !parentId && !o.dryRun) throw new Error(`parent ${u.parent} of ${u.name} missing`);
      const [found] = (await c.query<{ id: string }>(
        `SELECT id::text FROM "${s}".groups WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid LIMIT 1`, [u.name, parentId])).rows;
      if (found) { idOf.set(u.name, found.id); continue; }
      made++;
      if (o.dryRun) { out.push(`would add unit     ${u.parent ? `${u.parent} / ` : ''}${u.name}`); continue; }
      const [row] = (await c.query<{ id: string }>(`INSERT INTO "${s}".groups (name, parent_id) VALUES ($1, $2) RETURNING id::text`, [u.name, parentId])).rows;
      idOf.set(u.name, row.id);
      out.push(`unit               ${u.parent ? `${u.parent} / ` : ''}${u.name}`);
    }
    const hasKnowledge = (await c.query<{ t: string | null }>(`SELECT to_regclass('"${s}".knowledge')::text AS t`)).rows[0]?.t;
    if (!hasKnowledge) {
      out.push('no knowledge table yet (open the company once in Kara, then run this again for the products)');
    } else {
      for (const [i, p] of set.products.entries()) {
        const [found] = (await c.query(`SELECT 1 FROM "${s}".knowledge WHERE kind = 'product' AND code = $1`, [p.code])).rows;
        if (found) continue;
        made++;
        if (o.dryRun) { out.push(`would add product  ${p.code} ${p.name}`); continue; }
        await c.query(`INSERT INTO "${s}".knowledge (kind, name, code, summary, attributes, sequence) VALUES ('product', $1, $2, $3, $4, $5)`,
          [p.name, p.code, p.summary, JSON.stringify(p.features), (i + 1) * 10]);
        out.push(`product            ${p.code} ${p.name}`);
      }
    }
    if (made && !o.dryRun) {
      await c.query(`INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason) VALUES ('company', $1, $1, 'organisation seeded')
        ON CONFLICT (entity, entity_id) WHERE status = 'pending' DO NOTHING`, [company.id]);
    }
  });
  out.push('', `${made} ${o.dryRun ? 'to add (dry run: nothing written)' : 'added'}; already there: left as is`);
  return out;
}
