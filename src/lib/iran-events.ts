import { toGregorian, isoDate } from "./jalali";

/* ---------------------------------------------------------------------------
 * Official Iranian *occasions* that are NOT public holidays (مناسبت‌های
 * غیرتعطیل) — national, scientific and cultural commemoration days. They sit on
 * fixed Jalali dates each year, so they're fully deterministic. Shown on the
 * calendar (and attendance) as informational markers without making the day
 * off. Each company can still edit/remove them from the admin panel.
 * ------------------------------------------------------------------------- */

export interface OfficialOccasion {
  iso: string; // gregorian YYYY-MM-DD
  title: string;
}

/** Fixed solar occasions: [jMonth, jDay, title]. */
const FIXED_SOLAR_OCCASIONS: [number, number, string][] = [
  // فروردین
  [1, 19, "روز هنر انقلاب اسلامی"],
  // اردیبهشت
  [2, 1, "روز بزرگداشت سعدی"],
  [2, 10, "روز ملی خلیج فارس"],
  [2, 12, "روز معلم"],
  [2, 25, "روز بزرگداشت فردوسی"],
  // خرداد
  [3, 1, "روز بهره‌وری و بهینه‌سازی مصرف"],
  // تیر
  [4, 7, "روز قوهٔ قضاییه"],
  [4, 8, "روز مبارزه با سلاح‌های شیمیایی"],
  // مرداد
  [5, 14, "روز اهدای خون"],
  [5, 28, "روز بزرگداشت شیخ شهاب‌الدین سهروردی"],
  // شهریور
  [6, 1, "روز بزرگداشت ابوعلی سینا و روز پزشک"],
  [6, 4, "روز کارمند"],
  [6, 5, "روز بزرگداشت محمد بن زکریای رازی و روز داروسازی"],
  [6, 13, "روز بزرگداشت ابوریحان بیرونی"],
  [6, 31, "آغاز هفتهٔ دفاع مقدس"],
  // مهر
  [7, 8, "روز بزرگداشت مولوی"],
  [7, 13, "روز نیروی انتظامی"],
  [7, 20, "روز بزرگداشت حافظ"],
  // آبان
  [8, 13, "روز دانش‌آموز"],
  [8, 24, "روز کتاب و کتاب‌خوانی"],
  // آذر
  [9, 5, "روز بسیج مستضعفان"],
  [9, 7, "روز نیروی دریایی"],
  [9, 16, "روز دانشجو"],
  [9, 25, "روز پژوهش"],
  // دی
  [10, 5, "روز ایمنی در برابر زلزله"],
  // بهمن
  [11, 19, "روز نیروی هوایی"],
  // اسفند
  [12, 5, "روز بزرگداشت خواجه نصیرالدین طوسی و روز مهندس"],
  [12, 15, "روز درخت‌کاری"],
  [12, 25, "روز بزرگداشت پروین اعتصامی"],
];

/** All official non-holiday occasions falling within Jalali year `jy`. */
export function officialOccasionsFor(jy: number): OfficialOccasion[] {
  return FIXED_SOLAR_OCCASIONS.map(([jm, jd, title]) => ({
    iso: isoDate(toGregorian(jy, jm, jd)),
    title,
  }));
}
