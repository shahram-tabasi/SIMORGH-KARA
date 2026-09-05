/**
 * Panel (module) catalogue.
 *
 * سیمرغ‌کارا از چند «پنل» مستقل ساخته شده است: سازمان/کارتابل، منابع انسانی،
 * مالی (سیمرغ لجر)، انبار، HRC و درگاه API. هر شرکت فقط پنل‌هایی را می‌بیند که
 * برایش خریداری/فعال شده باشد؛ بنابراین یک هلدینگ می‌تواند برای یک شرکت فقط
 * انبار، و برای شرکت دیگر مالی + حضور و غیاب را فعال کند.
 *
 * زنجیرهٔ کنترل:
 *   پلتفرم (سوپرادمین) →  modules مجاز هر هلدینگ و هر شرکت
 *   هلدینگ            →  فعال/غیرفعال کردن پنل‌های شرکت‌های خودش (در سقف مجاز)
 *   شرکت              →  تخصیص مجوزهای هر پنل به نقش‌ها و تک‌تک افراد (RBAC)
 */

export const MODULE_KEYS = [
  "org",
  "hr",
  "finance",
  "inventory",
  "hrc",
  "api",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleMeta {
  key: ModuleKey;
  name: string;
  icon: string;
  description: string;
  /** Always-on modules cannot be switched off for a company. */
  always?: boolean;
}

export const MODULES: Record<ModuleKey, ModuleMeta> = {
  org: {
    key: "org",
    name: "سازمان و کارتابل",
    icon: "🏢",
    description: "اعضا، نقش‌ها، زیرگروه‌ها، کارتابل و میز کار — هستهٔ سامانه",
    always: true,
  },
  hr: {
    key: "hr",
    name: "منابع انسانی (حضور و غیاب)",
    icon: "🕒",
    description: "تردد، تقویم کاری، مرخصی و مأموریت، گزارش‌های حضور",
  },
  finance: {
    key: "finance",
    name: "مالی و حسابداری (سیمرغ لجر)",
    icon: "📒",
    description: "کدینگ حساب‌ها، سند دوطرفه، طرف‌حساب، مراکز هزینه و گزارش‌های مالی",
  },
  inventory: {
    key: "inventory",
    name: "انبار و کالا",
    icon: "📦",
    description: "انبارها، کالاها، رسید و حواله، درخواست کالا، کاردکس و موجودی",
  },
  hrc: {
    key: "hrc",
    name: "HRC — پایش سلامت و موقعیت",
    icon: "🛰️",
    description:
      "ساعت هوشمند کارکنان، پایش علائم حیاتی، موقعیت روی نقشهٔ شرکت و اعزام تیم امداد",
  },
  api: {
    key: "api",
    name: "درگاه API و یکپارچه‌سازی",
    icon: "🔌",
    description: "کلید API برای اتصال نرم‌افزارهای دیگر به داده‌های همین شرکت",
  },
};

export const MODULE_LIST: ModuleMeta[] = MODULE_KEYS.map((k) => MODULES[k]);

/** Modules switched on for a brand-new company unless the admin says otherwise. */
export const DEFAULT_MODULES: ModuleKey[] = ["org", "hr"];

/** Every module a holding may hand out unless the platform admin narrows it. */
export const ALL_MODULES: ModuleKey[] = [...MODULE_KEYS];

export function isModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

/**
 * Clean an arbitrary list coming from a form or the database: drop unknown
 * keys, de-duplicate, and always keep the always-on modules.
 */
export function normalizeModules(
  list: readonly string[] | null | undefined
): ModuleKey[] {
  const set = new Set<ModuleKey>();
  for (const k of MODULE_KEYS) if (MODULES[k].always) set.add(k);
  for (const k of list ?? []) if (isModuleKey(k)) set.add(k);
  return MODULE_KEYS.filter((k) => set.has(k));
}

export function hasModule(
  enabled: readonly string[],
  key: ModuleKey
): boolean {
  return MODULES[key].always || enabled.includes(key);
}

/** Intersection helper — a holding can only grant what the platform allowed it. */
export function intersectModules(
  wanted: readonly string[],
  allowed: readonly string[]
): ModuleKey[] {
  const allowedSet = new Set(normalizeModules(allowed));
  return normalizeModules(wanted).filter((k) => allowedSet.has(k));
}
