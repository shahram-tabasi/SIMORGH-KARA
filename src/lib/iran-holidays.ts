import { toGregorian, jalaliMonthLength, isoDate } from "./jalali";

/* ---------------------------------------------------------------------------
 * Official Iranian public holidays.
 *
 * Solar holidays sit on fixed Jalali dates every year (fully deterministic).
 * Religious holidays follow the Hijri (lunar) calendar and drift ~11 days per
 * solar year, so we convert them via the *tabular* Islamic calendar. Because
 * Iran fixes religious days by moon sighting, a converted date can differ from
 * the official one by ±1 day — imported holidays remain editable for that
 * reason.
 * ------------------------------------------------------------------------- */

export interface OfficialHoliday {
  iso: string; // gregorian YYYY-MM-DD
  title: string;
  lunar: boolean;
}

/** Fixed solar official holidays: [jMonth, jDay, title]. */
const FIXED_SOLAR: [number, number, string][] = [
  [1, 1, "عید نوروز"],
  [1, 2, "عید نوروز"],
  [1, 3, "عید نوروز"],
  [1, 4, "عید نوروز"],
  [1, 12, "روز جمهوری اسلامی"],
  [1, 13, "روز طبیعت (سیزده‌به‌در)"],
  [3, 14, "رحلت امام خمینی"],
  [3, 15, "قیام ۱۵ خرداد"],
  [11, 22, "پیروزی انقلاب اسلامی"],
  [12, 29, "روز ملی شدن صنعت نفت"],
];

/** Religious holidays by Hijri date: [hMonth, hDay, title]. */
const LUNAR: [number, number, string][] = [
  [1, 9, "تاسوعای حسینی"],
  [1, 10, "عاشورای حسینی"],
  [2, 20, "اربعین حسینی"],
  [2, 28, "رحلت پیامبر و شهادت امام حسن مجتبی"],
  [2, 30, "شهادت امام رضا (ع)"],
  [3, 17, "میلاد پیامبر اکرم و امام جعفر صادق"],
  [7, 27, "مبعث رسول اکرم"],
  [8, 15, "ولادت حضرت قائم (نیمه شعبان)"],
  [9, 21, "شهادت حضرت علی (ع)"],
  [10, 1, "عید سعید فطر"],
  [10, 2, "تعطیل عید فطر"],
  [10, 25, "شهادت امام جعفر صادق"],
  [12, 10, "عید سعید قربان"],
  [12, 18, "عید سعید غدیر خم"],
];

/* ----------------------------- calendar math ----------------------------- */

function gregorianToJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function jdnToGregorian(jdn: number): Date {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year, month - 1, day);
}

/** Tabular Islamic calendar → Julian Day Number. */
function islamicToJDN(iy: number, im: number, id: number): number {
  return (
    id +
    Math.ceil(29.5 * (im - 1)) +
    (iy - 1) * 354 +
    Math.floor((3 + 11 * iy) / 30) +
    1948439
  );
}

function jdnToDate(jdn: number): Date {
  return jdnToGregorian(jdn);
}

/** All official Iranian holidays falling within Jalali year `jy`. */
export function officialHolidaysFor(jy: number): OfficialHoliday[] {
  const out: OfficialHoliday[] = [];

  for (const [jm, jd, title] of FIXED_SOLAR) {
    out.push({ iso: isoDate(toGregorian(jy, jm, jd)), title, lunar: false });
  }

  // Jalali year bounds as JDN.
  const g1 = toGregorian(jy, 1, 1);
  const g2 = toGregorian(jy, 12, jalaliMonthLength(jy, 12));
  const start = gregorianToJDN(g1.getFullYear(), g1.getMonth() + 1, g1.getDate());
  const end = gregorianToJDN(g2.getFullYear(), g2.getMonth() + 1, g2.getDate());

  // Hijri years overlapping this Jalali year (scan a small window).
  const hyEstimate = Math.floor((jy - 1) * 1.0307) + 1;
  for (let iy = hyEstimate - 2; iy <= hyEstimate + 2; iy++) {
    for (const [hm, hd, title] of LUNAR) {
      const jdn = islamicToJDN(iy, hm, hd);
      if (jdn >= start && jdn <= end) {
        out.push({ iso: isoDate(jdnToDate(jdn)), title, lunar: true });
      }
    }
  }

  return out;
}
