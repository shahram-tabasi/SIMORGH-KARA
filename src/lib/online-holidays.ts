import { officialHolidaysFor, type OfficialHoliday } from "./iran-holidays";

/* ---------------------------------------------------------------------------
 * Online holiday source.
 *
 * The app reads the official Iranian holiday calendar *online* from a curated
 * dataset (`data/holidays.json`) so that religious (lunar) dates stay accurate
 * and can be corrected after an official announcement — without redeploying.
 * Each tenant's "همگام‌سازی آنلاین" pulls from here.
 *
 * If the network is unavailable (offline install / blocked egress), we fall
 * back to the deterministic tabular computation in `iran-holidays.ts`.
 * ------------------------------------------------------------------------- */

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/shahram-tabasi/simorgh-kara/" +
  "claude/confident-heisenberg-ccqiku/data/holidays.json";

/** Where to fetch the dataset from (overridable per deployment). */
function sourceUrl(): string {
  return process.env.HOLIDAYS_SOURCE_URL?.trim() || DEFAULT_SOURCE;
}

interface DatasetRow {
  date: string; // gregorian YYYY-MM-DD
  title: string;
  lunar?: boolean;
}
interface Dataset {
  years: Record<string, DatasetRow[]>;
}

export interface HolidaySyncResult {
  holidays: OfficialHoliday[];
  source: "online" | "offline";
}

/**
 * Official holidays for a Jalali year, read online with an offline fallback.
 * Never throws — on any failure it returns the computed set and `offline`.
 */
export async function fetchOfficialHolidays(
  jy: number
): Promise<HolidaySyncResult> {
  try {
    const res = await fetch(sourceUrl(), {
      // always hit the network for the freshest correction set
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Dataset;
    const rows = data?.years?.[String(jy)];
    if (Array.isArray(rows) && rows.length > 0) {
      return {
        holidays: rows.map((r) => ({
          iso: r.date,
          title: r.title,
          lunar: !!r.lunar,
        })),
        source: "online",
      };
    }
    throw new Error("year not present in dataset");
  } catch {
    return { holidays: officialHolidaysFor(jy), source: "offline" };
  }
}
