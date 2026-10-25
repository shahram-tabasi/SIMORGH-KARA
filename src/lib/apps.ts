// The platform apps a company can be given, and what a person can be in each
// (docs/INTEGRATION.md). Each sign-in app has its own Keycloak realm; kara-api's
// provisioner maps these roles to that realm's roles (PROVISION_APPS). `erp`
// has no roles: it keeps the company's units and people in Odoo.

export interface AppRole { key: string; label: string; note: string }
export interface AppDef { key: AppKey; label: string; note: string; roles: AppRole[] }

export type AppKey = "designSuite" | "hrChatbot" | "erp";

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
  {
    // Not a sign-in: the company's units and people kept in Odoo (departments,
    // employees), in the Odoo company linked to it (made when missing).
    key: "erp",
    label: "Odoo (ERP)",
    note: "واحدها و افراد شرکت در Odoo به‌صورت دپارتمان و کارمند نگه داشته می‌شوند",
    roles: [],
  },
];

export type CompanyApps = Partial<Record<AppKey, boolean>>;

export const appByKey = (k: string) => APPS.find((a) => a.key === k);

/** A role key valid for that app. */
export const isAppRole = (app: string, role: string) => !!appByKey(app)?.roles.some((r) => r.key === role);
