/**
 * Permission catalog. Every protected action in the tenant app maps to one of
 * these keys. A role grants a set of keys; a member inherits the union of the
 * keys from all their roles, plus their own per-person overrides
 * (`member_permissions`) — a grant adds a single key without giving the whole
 * role, a deny takes one key back from a role. This is the «سطح دسترسی جز به
 * جز» model: access can be tuned key-by-key for each person.
 *
 * Every key belongs to a module (پنل). Keys of a module that is not enabled for
 * the company are stripped from the effective permission set in
 * `requireTenant`, so a disabled panel is invisible *and* unusable even if an
 * old role still carries its keys.
 */

import { MODULES, type ModuleKey } from "./modules";

export const PERMISSIONS = {
  /* ------------------------------ سازمان ------------------------------- */
  "members.view": "مشاهده اعضا",
  "members.manage": "مدیریت اعضا (افزودن/ویرایش/حذف)",
  "members.permissions.manage": "تنظیم دسترسی جز‌به‌جز هر عضو",
  "roles.view": "مشاهده نقش‌ها",
  "roles.manage": "مدیریت نقش‌ها و سطوح دسترسی",
  "groups.view": "مشاهده زیرگروه‌ها",
  "groups.manage": "مدیریت زیرگروه‌ها",
  "kartabl.assign": "ارجاع کار به کارتابل دیگران",
  "kartabl.view_all": "مشاهده کارتابل همه اعضا",
  "kartabl.manage": "مدیریت کامل کارتابل‌ها (ویرایش/حذف کار دیگران)",
  "tasks.assign": "ارسال و ارجاع وظیفه در میز کار (مدیر/سرگروه)",
  "settings.manage": "مدیریت تنظیمات شرکت",

  /* --------------------------- منابع انسانی ---------------------------- */
  "calendar.view": "مشاهده تقویم کاری",
  "calendar.manage": "مدیریت تقویم، ساعت کاری و تعطیلات",
  "attendance.manage": "مدیریت حضور و غیاب همه اعضا",
  "leave.approve": "تأیید مرخصی — مدیر بخش (مرحله اول)",
  "leave.approve.hr": "تأیید مرخصی — مسئول کارگزینی (مرحله دوم)",
  "leave.approve.l3": "تأیید مرخصی — مدیرعامل (مرحله سوم، انواع خاص)",
  "leave.types.manage": "تعریف و ویرایش انواع مرخصی و قوانین آن‌ها",
  "leave.ledger.manage": "مدیریت مانده مرخصی: بازخرید، ذخیره/سوخت پایان سال، تعدیل",

  /* -------------------------- مالی (سیمرغ لجر) ------------------------- */
  "ledger.view": "مشاهده دفتر کل و اسناد مالی",
  "ledger.manage": "ثبت و ویرایش سند حسابداری (پیش‌نویس)",
  "finance.accounts.manage": "مدیریت کدینگ و سرفصل حساب‌ها",
  "finance.entries.post": "قطعی/ثبت نهایی سند حسابداری",
  "finance.entries.void": "ابطال سند حسابداری",
  "finance.parties.manage": "مدیریت طرف‌حساب‌ها (مشتری/تأمین‌کننده)",
  "finance.costcenters.manage": "مدیریت مراکز هزینه",
  "finance.periods.manage": "مدیریت سال مالی و بستن دوره",
  "finance.reports.view": "مشاهده گزارش‌های مالی (تراز، معین، دفتر روزنامه)",

  /* -------------------------------- انبار ------------------------------ */
  "inventory.view": "مشاهده موجودی و اسناد انبار",
  "inventory.warehouses.manage": "تعریف و مدیریت انبارها",
  "inventory.items.manage": "تعریف و مدیریت کالاها و گروه‌های کالا",
  "inventory.receipt": "ثبت رسید ورود کالا",
  "inventory.issue": "ثبت حواله خروج کالا",
  "inventory.transfer": "ثبت انتقال بین انبارها",
  "inventory.adjust": "ثبت اصلاح موجودی و انبارگردانی",
  "inventory.docs.approve": "تأیید و قطعی‌کردن اسناد انبار",
  "inventory.request": "ثبت درخواست کالا",
  "inventory.request.approve": "تأیید درخواست کالا",
  "inventory.reports.view": "مشاهده گزارش‌های انبار (کاردکس، کسری، ارزش موجودی)",

  /* --------------------------------- HRC ------------------------------- */
  "hrc.view": "مشاهده وضعیت سلامت و موقعیت خودم",
  "hrc.monitor": "پایش زندهٔ سلامت و موقعیت همهٔ نفرات",
  "hrc.devices.manage": "مدیریت ساعت‌های هوشمند و دستگاه‌های پایش",
  "hrc.map.manage": "مدیریت نقشهٔ شرکت و ناحیه‌بندی (ژئوفنس)",
  "hrc.alerts.manage": "رسیدگی به هشدارها (تأیید، بستن، ثبت اقدام)",
  "hrc.teams.manage": "مدیریت تیم‌های امداد و واکنش (HRC)",
  "hrc.dispatch": "اعزام تیم HRC به محل حادثه",
  "hrc.thresholds.manage": "تنظیم آستانه‌های سلامت و قوانین هشدار",

  /* --------------------------------- API ------------------------------- */
  "api.keys.manage": "مدیریت کلیدهای API و اتصال نرم‌افزارهای دیگر",
  "api.read": "خواندن داده‌ها از طریق API",
  "api.write": "نوشتن داده از طریق API",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Which module (پنل) each permission belongs to. */
export const PERMISSION_MODULE: Record<PermissionKey, ModuleKey> = {
  "members.view": "org",
  "members.manage": "org",
  "members.permissions.manage": "org",
  "roles.view": "org",
  "roles.manage": "org",
  "groups.view": "org",
  "groups.manage": "org",
  "kartabl.assign": "org",
  "kartabl.view_all": "org",
  "kartabl.manage": "org",
  "tasks.assign": "org",
  "settings.manage": "org",

  "calendar.view": "hr",
  "calendar.manage": "hr",
  "attendance.manage": "hr",
  "leave.approve": "hr",
  "leave.approve.hr": "hr",
  "leave.approve.l3": "hr",
  "leave.types.manage": "hr",
  "leave.ledger.manage": "hr",

  "ledger.view": "finance",
  "ledger.manage": "finance",
  "finance.accounts.manage": "finance",
  "finance.entries.post": "finance",
  "finance.entries.void": "finance",
  "finance.parties.manage": "finance",
  "finance.costcenters.manage": "finance",
  "finance.periods.manage": "finance",
  "finance.reports.view": "finance",

  "inventory.view": "inventory",
  "inventory.warehouses.manage": "inventory",
  "inventory.items.manage": "inventory",
  "inventory.receipt": "inventory",
  "inventory.issue": "inventory",
  "inventory.transfer": "inventory",
  "inventory.adjust": "inventory",
  "inventory.docs.approve": "inventory",
  "inventory.request": "inventory",
  "inventory.request.approve": "inventory",
  "inventory.reports.view": "inventory",

  "hrc.view": "hrc",
  "hrc.monitor": "hrc",
  "hrc.devices.manage": "hrc",
  "hrc.map.manage": "hrc",
  "hrc.alerts.manage": "hrc",
  "hrc.teams.manage": "hrc",
  "hrc.dispatch": "hrc",
  "hrc.thresholds.manage": "hrc",

  "api.keys.manage": "api",
  "api.read": "api",
  "api.write": "api",
};

export function isPermissionKey(key: string): key is PermissionKey {
  return key in PERMISSIONS;
}

export function permissionsOfModule(module: ModuleKey): PermissionKey[] {
  return ALL_PERMISSIONS.filter((k) => PERMISSION_MODULE[k] === module);
}

/** Permission keys grouped by module — used by the role/member access screens. */
export function permissionGroups(
  enabledModules?: readonly string[]
): { module: ModuleKey; title: string; icon: string; keys: PermissionKey[] }[] {
  return (Object.keys(MODULES) as ModuleKey[])
    .filter((m) => !enabledModules || MODULES[m].always || enabledModules.includes(m))
    .map((m) => ({
      module: m,
      title: MODULES[m].name,
      icon: MODULES[m].icon,
      keys: permissionsOfModule(m),
    }))
    .filter((g) => g.keys.length > 0);
}

/** Drop the keys of modules the company has not enabled. */
export function filterByModules(
  keys: Iterable<string>,
  enabledModules: readonly string[]
): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    if (!isPermissionKey(k)) continue;
    const mod = PERMISSION_MODULE[k];
    if (MODULES[mod].always || enabledModules.includes(mod)) out.add(k);
  }
  return out;
}

/** Default roles created for every new tenant. */
export const DEFAULT_ROLES: {
  name: string;
  description: string;
  permissions: PermissionKey[];
  is_system: boolean;
}[] = [
  {
    name: "مدیر سامانه",
    description: "دسترسی کامل به تمام بخش‌های شرکت",
    permissions: ALL_PERMISSIONS,
    is_system: true,
  },
  {
    name: "کاربر",
    description: "دسترسی پایه — فقط کارتابل شخصی خود",
    permissions: ["calendar.view", "hrc.view"],
    is_system: true,
  },
  {
    name: "مدیر مالی",
    description: "قالب آماده — دسترسی کامل به پنل مالی (سیمرغ لجر)",
    permissions: permissionsOfModule("finance"),
    is_system: false,
  },
  {
    name: "حسابدار",
    description: "قالب آماده — ثبت سند پیش‌نویس و مشاهدهٔ گزارش‌ها بدون قطعی‌کردن",
    permissions: [
      "ledger.view",
      "ledger.manage",
      "finance.parties.manage",
      "finance.reports.view",
    ],
    is_system: false,
  },
  {
    name: "مدیر انبار",
    description: "قالب آماده — دسترسی کامل به پنل انبار",
    permissions: permissionsOfModule("inventory"),
    is_system: false,
  },
  {
    name: "انباردار",
    description: "قالب آماده — رسید و حواله و مشاهدهٔ موجودی، بدون تأیید نهایی",
    permissions: [
      "inventory.view",
      "inventory.receipt",
      "inventory.issue",
      "inventory.transfer",
      "inventory.request",
      "inventory.reports.view",
    ],
    is_system: false,
  },
  {
    name: "کارشناس HRC",
    description: "قالب آماده — پایش سلامت و موقعیت نفرات و اعزام تیم",
    permissions: [
      "hrc.view",
      "hrc.monitor",
      "hrc.alerts.manage",
      "hrc.dispatch",
      "hrc.teams.manage",
    ],
    is_system: false,
  },
];

export function hasPermission(
  granted: Set<string>,
  required: PermissionKey
): boolean {
  return granted.has(required);
}
