/**
 * کدینگ پیش‌فرض حساب‌ها — a starter chart of accounts seeded for every company
 * that gets the finance panel. Level 1 rows are groups (کل) and level 2 rows are
 * the postable معین accounts beneath them.
 */
export interface SeedAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  children: { code: string; name: string }[];
}

export const DEFAULT_ACCOUNTS: SeedAccount[] = [
  {
    code: "1",
    name: "دارایی‌های جاری",
    type: "asset",
    children: [
      { code: "101", name: "صندوق" },
      { code: "102", name: "بانک" },
      { code: "103", name: "حساب‌های دریافتنی تجاری" },
      { code: "104", name: "موجودی مواد و کالا" },
      { code: "105", name: "پیش‌پرداخت‌ها" },
      { code: "106", name: "تنخواه‌گردان" },
    ],
  },
  {
    code: "2",
    name: "دارایی‌های غیرجاری",
    type: "asset",
    children: [
      { code: "201", name: "اموال، ماشین‌آلات و تجهیزات" },
      { code: "202", name: "استهلاک انباشته" },
    ],
  },
  {
    code: "3",
    name: "بدهی‌ها",
    type: "liability",
    children: [
      { code: "301", name: "حساب‌های پرداختنی تجاری" },
      { code: "302", name: "حقوق و دستمزد پرداختنی" },
      { code: "303", name: "مالیات و بیمه پرداختنی" },
      { code: "304", name: "پیش‌دریافت‌ها" },
    ],
  },
  {
    code: "4",
    name: "حقوق صاحبان سهام",
    type: "equity",
    children: [
      { code: "401", name: "سرمایه" },
      { code: "402", name: "سود (زیان) انباشته" },
    ],
  },
  {
    code: "5",
    name: "درآمدها",
    type: "income",
    children: [
      { code: "501", name: "فروش کالا" },
      { code: "502", name: "درآمد خدمات" },
    ],
  },
  {
    code: "6",
    name: "هزینه‌ها",
    type: "expense",
    children: [
      { code: "601", name: "بهای تمام‌شدهٔ کالای فروش‌رفته" },
      { code: "602", name: "هزینهٔ حقوق و دستمزد" },
      { code: "603", name: "هزینه‌های اداری و عمومی" },
      { code: "604", name: "کسری و ضایعات انبار" },
    ],
  },
];

/** The معین account inventory documents post against by default. */
export const INVENTORY_ACCOUNT_CODE = "104";
export const INVENTORY_COUNTERPART = {
  receipt: "301", // خرید نسیه: بستانکار حساب‌های پرداختنی
  issue: "601", // مصرف/فروش: بدهکار بهای تمام‌شده
  adjust_in: "604",
  adjust_out: "604",
} as const;
