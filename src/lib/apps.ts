// The platform apps a company can be given, and what a person can be in each
// (docs/INTEGRATION.md). Each sign-in app has its own Keycloak realm; kara-api's
// provisioner maps these roles to that realm's roles (PROVISION_APPS). `erp`
// has no roles: it keeps the company's units and people in Odoo.

export interface AppRole { key: string; label: string; note: string }
export interface AppDef { key: AppKey; label: string; note: string; roles: AppRole[] }

export type AppKey = "designSuite" | "hrChatbot" | "erp" | "plane" | "mattermost";

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
    // Team Platform (docs/TEAM-PLATFORM.md): kara-api makes the person's
    // account (a team per company, default channels) and deactivates it when
    // the role is taken away. Sign-in with the Kara account (button "GitLab").
    key: "mattermost",
    label: "گفتگوی تیمی (Mattermost)",
    note: "پیام‌رسان تیمی شرکت در team.simorghai.com؛ حساب را کارا می‌سازد و با حساب کارا وارد می‌شوند",
    roles: [{ key: "user", label: "کاربر", note: "گفتگو در تیم شرکت و دستیار سیمرغ" }],
  },
  {
    // One Plane workspace; kara-api invites the person with the role below.
    key: "plane",
    label: "پروژه‌ها (Plane)",
    note: "مدیریت پروژه و کارهای نرم‌افزار/فناوری در plane.simorghai.com؛ دعوت را کارا می‌فرستد",
    roles: [
      { key: "member", label: "عضو", note: "ساخت و انجام کارها در پروژه‌ها" },
      { key: "admin", label: "مدیر فضای کار", note: "مدیریت پروژه‌ها و اعضا در Plane" },
      { key: "guest", label: "مهمان", note: "فقط دیدن پروژه‌هایی که به آن دعوت شده" },
    ],
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
