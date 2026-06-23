import "server-only";
import { withTenant } from "./db";
import {
  toGregorian,
  isoDate,
  jalaliMonthLength,
} from "./jalali";
import { fetchOfficialHolidays } from "./online-holidays";

/**
 * Ensure a tenant's official holidays for a whole Jalali year exist, fetching
 * them online (with offline fallback) only when missing. Idempotent and cheap
 * — a single COUNT guards the network call — so it is safe to invoke lazily on
 * page render and from the cron route alike.
 *
 * Returns how many rows were inserted (0 when already seeded).
 */
export async function ensureYearHolidays(
  schema: string,
  jy: number
): Promise<number> {
  const firstIso = isoDate(toGregorian(jy, 1, 1));
  const lastIso = isoDate(toGregorian(jy, 12, jalaliMonthLength(jy, 12)));

  return withTenant(schema, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM holidays
      WHERE is_official = true AND holiday_date BETWEEN ${firstIso} AND ${lastIso}
    `;
    if (n > 0) return 0;

    const { holidays } = await fetchOfficialHolidays(jy);
    for (const h of holidays) {
      await tx`
        INSERT INTO holidays (holiday_date, title, is_official)
        VALUES (${h.iso}, ${h.title}, true)
        ON CONFLICT (holiday_date) DO NOTHING
      `;
    }
    return holidays.length;
  });
}
