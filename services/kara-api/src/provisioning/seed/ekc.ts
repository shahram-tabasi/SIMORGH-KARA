// EKC (Electrokavir): its organisation chart (Chart-1405_05_04), where its
// people sit in it, its products, and its HR rules (seed/ekc/hr-rules.json,
// built from the documents by seed/ekc/build-hr-rules.py).
//
// The chart's dashed boxes — الکترو تدبیر under customer services and آرمان
// تدبیر under business development — are companies of their own (EKWI-AD-010
// calls them «شرکت‌های همکار»), not units of EKC: they are left out.
//
// simorgh-odoo deploy/scripts/seed-ekc.py names the same departments for
// its job positions — change both together.

import type { OrgSet, UnitNode } from '../seed-org';

const u = (name: string, ...children: UnitNode[]): UnitNode => ({ name, children });

const CHART: UnitNode = u('هیئت مدیره',
  u('حسابرس داخلی'),
  u('مشاوران هیئت مدیره'),
  u('مدیر عامل',
    u('امور حقوقی و قراردادها'),
    u('کمیته‌های راهبردی و تیم منتورینگ'),
    u('دفتر نظارت و پایش پروژه‌ها'),
    u('خدمات مشتریان', u('فروش قطعات'), u('گارانتی و پشتیبانی مشتریان')),
    u('TQMS', u('HSE'), u('QC'), u('Strategy Tracing'), u('QA'), u('BPMS'), u('AI')),
    u('تولید و عملیات', u('ساخت'), u('مونتاژ (MV-LV)'), u('PM'), u('رنگ و آبکاری')),
    u('سرمایه انسانی', u('رشد و توسعه'), u('کارگزینی'), u('پشتیبانی'), u('حراست'), u('IT')),
    u('امور مالی', u('انبار'), u('حسابداری'), u('تأمین منابع مالی'), u('حسابداری صنعتی'), u('مدیریت دارایی‌ها')),
    u('بازرگانی و تأمین تجهیزات', u('خرید داخلی'), u('بازرگانی خارجی'), u('خرید خدمات'), u('سورسینگ')),
    u('توسعه کسب و کار', u('توسعه بازار'), u('توسعه محصول'), u('مدیریت طرح‌ها')),
    u('فنی و پروژه‌ها', u('اجرایی پروژه'), u('مدیریت پروژه'), u('فنی و مهندسی'), u('کنترل پروژه'), u('مدیریت Close Out')),
    u('فروش', u('مهندسی فروش'), u('فروش')),
  ),
);

const TECH = ['هیئت مدیره', 'مدیر عامل', 'فنی و پروژه‌ها', 'فنی و مهندسی'];

export const EKC: OrgSet = {
  chart: CHART,
  // Units an earlier seed-org made (a generic panel-builder layout) that are
  // plainly one of the chart's: renamed or merged into it, members and all.
  aliases: {
    'مدیریت عامل': ['هیئت مدیره', 'مدیر عامل'],
    'دفتر مدیریت سیستم‌ها و تضمین کیفیت': ['هیئت مدیره', 'مدیر عامل', 'TQMS', 'QA'],
    'ایمنی، بهداشت و محیط زیست': ['هیئت مدیره', 'مدیر عامل', 'TQMS', 'HSE'],
    'معاونت فروش و بازاریابی': ['هیئت مدیره', 'مدیر عامل', 'فروش'],
    'مناقصات و برآورد': ['هیئت مدیره', 'مدیر عامل', 'فروش', 'مهندسی فروش'],
    'فروش و ارتباط با مشتریان': ['هیئت مدیره', 'مدیر عامل', 'فروش', 'فروش'],
    'معاونت مهندسی': ['هیئت مدیره', 'مدیر عامل', 'فنی و پروژه‌ها'],
    'طراحی برق': TECH,
    'طراحی مکانیک': TECH,
    'مستندات فنی': TECH,
    'معاونت بازرگانی و تأمین': ['هیئت مدیره', 'مدیر عامل', 'بازرگانی و تأمین تجهیزات'],
    'خرید خارجی و ترخیص': ['هیئت مدیره', 'مدیر عامل', 'بازرگانی و تأمین تجهیزات', 'بازرگانی خارجی'],
    'معاونت تولید': ['هیئت مدیره', 'مدیر عامل', 'تولید و عملیات'],
    'ساخت بدنه و ورق‌کاری': ['هیئت مدیره', 'مدیر عامل', 'تولید و عملیات', 'ساخت'],
    'رنگ': ['هیئت مدیره', 'مدیر عامل', 'تولید و عملیات', 'رنگ و آبکاری'],
    'مونتاژ و سیم‌کشی فشار ضعیف': ['هیئت مدیره', 'مدیر عامل', 'تولید و عملیات', 'مونتاژ (MV-LV)'],
    'مونتاژ فشار متوسط': ['هیئت مدیره', 'مدیر عامل', 'تولید و عملیات', 'مونتاژ (MV-LV)'],
    'کنترل کیفیت و آزمون': ['هیئت مدیره', 'مدیر عامل', 'TQMS', 'QC'],
    'خدمات پس از فروش و راه‌اندازی': ['هیئت مدیره', 'مدیر عامل', 'خدمات مشتریان'],
    'مالی و حسابداری': ['هیئت مدیره', 'مدیر عامل', 'امور مالی'],
    'منابع انسانی و امور اداری': ['هیئت مدیره', 'مدیر عامل', 'سرمایه انسانی'],
    'فناوری اطلاعات': ['هیئت مدیره', 'مدیر عامل', 'سرمایه انسانی', 'IT'],
    // The unit EKC's people came in with from Simorgh Design Suite.
    'Engineering': TECH,
    'مهندسی': TECH,
  },
  // Everyone already in EKC who is not yet in a unit of the chart goes to
  // technical & engineering; these people are named.
  defaultUnit: TECH,
  people: [
    { names: ['امیرحسین رضایی', 'امیر حسین رضایی', 'Amir Hossein Rezaei', 'Amirhossein Rezaei', 'Amir Hosein Rezaei'], unit: ['هیئت مدیره', 'مدیر عامل', 'فروش', 'مهندسی فروش'] },
    { names: ['حمید منتظری', 'Hamid Montazeri'], unit: ['هیئت مدیره'] },
  ],
  // The platform's owners: Kara platform administrators, and EKC members in
  // AI with the company's full role.
  owners: [
    { email: 's.tabasi@simorghai.com', name: 'Shahram Tabasi', unit: ['هیئت مدیره', 'مدیر عامل', 'TQMS', 'AI'] },
    { email: 'h.valikhani@simorghai.com', name: 'H. Valikhani', unit: ['هیئت مدیره', 'مدیر عامل', 'TQMS', 'AI'] },
  ],
  hrRules: 'ekc/hr-rules.json',
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
