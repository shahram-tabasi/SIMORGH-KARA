import "server-only";
import { withTenant } from "./db";
import {
  toGregorian,
  isoDate,
  jalaliMonthLength,
} from "./jalali";
import { fetchOfficialHolidays } from "./online-holidays";
import { officialOccasionsFor } from "./iran-events";

/**
 * Ensure a tenant's official days for a whole Jalali year exist — both the
 * public holidays (is_off=true, fetched online with offline fallback) and the
 * informational occasions (is_off=false, deterministic solar dates). Holidays
 * and occasions are guarded independently so existing tenants (which already
 * have holidays) still receive occasions on the next view/cron run.
 *
 * Idempotent and cheap. Returns how many rows were inserted (0 when seeded).
 */
export async function ensureYearHolidays(
  schema: string,
  jy: number
): Promise<number> {
  const firstIso = isoDate(toGregorian(jy, 1, 1));
  const lastIso = isoDate(toGregorian(jy, 12, jalaliMonthLength(jy, 12)));

  return withTenant(schema, async (tx) => {
    let inserted = 0;

    // 1) Public holidays (days off).
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM holidays
      WHERE is_official = true AND is_off = true
        AND holiday_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    if (n === 0) {
      const { holidays } = await fetchOfficialHolidays(jy);
      for (const h of holidays) {
        await tx`
          INSERT INTO holidays (holiday_date, title, is_official, is_off)
          VALUES (${h.iso}, ${h.title}, true, true)
          ON CONFLICT (holiday_date) DO NOTHING
        `;
      }
      inserted += holidays.length;
    }

    // 2) Informational occasions (not days off).
    const [{ m }] = await tx<{ m: number }[]>`
      SELECT count(*)::int AS m FROM holidays
      WHERE is_official = true AND is_off = false
        AND holiday_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    if (m === 0) {
      const occasions = officialOccasionsFor(jy);
      for (const o of occasions) {
        await tx`
          INSERT INTO holidays (holiday_date, title, is_official, is_off)
          VALUES (${o.iso}, ${o.title}, true, false)
          ON CONFLICT (holiday_date) DO NOTHING
        `;
      }
      inserted += occasions.length;
    }

    return inserted;
  });
}
