import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureYearHolidays } from "@/lib/holiday-sync";
import { todayJalali } from "@/lib/jalali";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled holiday sync. Ensures every tenant has official holidays for the
 * current and the next two Jalali years — so future years are populated ahead
 * of time without anyone clicking «همگام‌سازی». Idempotent: a year already
 * seeded is skipped.
 *
 * Schedule it from any cron (platform scheduler, GitHub Action, etc.):
 *   GET /api/cron/holidays?secret=$CRON_SECRET
 * If CRON_SECRET is unset the endpoint is open (suitable for trusted networks).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided =
      url.searchParams.get("secret") ?? req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const jy = todayJalali().jy;
  const years = [jy, jy + 1, jy + 2];
  const companies = await sql<{ schema_name: string }[]>`
    SELECT schema_name FROM platform.companies
  `;

  let inserted = 0;
  const perCompany: { schema: string; inserted: number }[] = [];
  for (const c of companies) {
    let n = 0;
    for (const y of years) {
      try {
        n += await ensureYearHolidays(c.schema_name, y);
      } catch {
        // a single tenant failure must not abort the whole run
      }
    }
    inserted += n;
    if (n > 0) perCompany.push({ schema: c.schema_name, inserted: n });
  }

  return NextResponse.json({
    ok: true,
    years,
    companies: companies.length,
    inserted,
    perCompany,
  });
}
