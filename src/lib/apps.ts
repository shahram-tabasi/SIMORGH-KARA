// The platform apps a company can be given, and what a person can be in each
// (docs/INTEGRATION.md). Each app has its own Keycloak realm; kara-api's
// provisioner maps these roles to that realm's roles (PROVISION_APPS).

export interface AppRole { key: string; label: string; note: string }
export interface AppDef { key: AppKey; label: string; note: string; roles: AppRole[] }

export type AppKey = "designSuite" | "hrChatbot";

export const APPS: AppDef[] = [
  {
    key: "designSuite",
    label: "Simorgh Design Suite",
    note: "طراحی تابلو برق، اسناد پروژه و پیشنهاد فنی (ورود با Keycloak، realm simorgh)",
    roles: [
      { key: "offer", label: "پیشنهاد فنی (Offer)", note: "Offer Template، گزارش‌ها و اسناد" },
      { key: "engineering", label: "مهندسی (Engineering)", note: "Create Template، Scope Selection، طراحی" },
    ],
  },
  {
    key: "hrChatbot",
    label: "دستیار منابع انسانی",
    note: "پاسخ بر اساس آیین‌نامه‌ها و بخشنامه‌های همین شرکت (ورود با Keycloak، realm hr)",
    roles: [{ key: "user", label: "کاربر", note: "پرسیدن از دستیار" }],
  },
];

export type CompanyApps = Partial<Record<AppKey, boolean>>;

export const appByKey = (k: string) => APPS.find((a) => a.key === k);

/** A role key valid for that app. */
export const isAppRole = (app: string, role: string) => !!appByKey(app)?.roles.some((r) => r.key === role);
