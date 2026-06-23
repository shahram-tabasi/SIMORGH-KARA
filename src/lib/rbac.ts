/**
 * Permission catalog. Every protected action in the tenant app maps to one of
 * these keys. A role grants a set of keys; a member inherits the union of the
 * keys from all their roles.
 */

export const PERMISSIONS = {
  "members.view": "مشاهده اعضا",
  "members.manage": "مدیریت اعضا (افزودن/ویرایش/حذف)",
  "roles.view": "مشاهده نقش‌ها",
  "roles.manage": "مدیریت نقش‌ها و سطوح دسترسی",
  "groups.view": "مشاهده زیرگروه‌ها",
  "groups.manage": "مدیریت زیرگروه‌ها",
  "kartabl.assign": "ارجاع کار به کارتابل دیگران",
  "kartabl.view_all": "مشاهده کارتابل همه اعضا",
  "kartabl.manage": "مدیریت کامل کارتابل‌ها (ویرایش/حذف کار دیگران)",
  "calendar.view": "مشاهده تقویم کاری",
  "calendar.manage": "مدیریت تقویم، ساعت کاری و تعطیلات",
  "attendance.manage": "مدیریت حضور و غیاب همه اعضا",
  "ledger.view": "مشاهده دفتر کل",
  "ledger.manage": "ثبت و مدیریت اسناد دفتر کل",
  "settings.manage": "مدیریت تنظیمات شرکت",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return key in PERMISSIONS;
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
    permissions: ["calendar.view", "ledger.view"],
    is_system: true,
  },
];

export function hasPermission(
  granted: Set<string>,
  required: PermissionKey
): boolean {
  return granted.has(required);
}
