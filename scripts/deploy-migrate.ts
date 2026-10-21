/**
 * The database step of a deploy (the chart's kara-migrate Job), safe to run
 * on every release:
 *   1. the platform schema (PLATFORM_DDL, idempotent);
 *   2. the first platform admin, only while there is none: SUPERADMIN_EMAIL
 *      and SUPERADMIN_NAME, a random password nobody knows (sign-in is
 *      Keycloak; kara-api's import-identities gives them their login);
 *   3. scripts/migrate.ts: every tenant schema brought up to date.
 * Unlike db:seed it never resets an existing password and prints no secret.
 *
 *   node --import tsx scripts/deploy-migrate.ts
 */
import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { join } from "path";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PLATFORM_DDL } from "../src/lib/sql";

/** Waits for the database here, every 3 s for up to 10 minutes: left to the
 *  Job's restarts, the backoff (10 s, 20 s, … 5 min) outlasts a Postgres that
 *  was ready long before, and helm's hook times out. */
async function waitForDatabase(sql: postgres.Sql) {
  const deadline = Date.now() + 10 * 60_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      if (attempt === 1 || attempt % 10 === 0) console.log(`… waiting for the database (${(e as Error).message})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await waitForDatabase(sql);
    console.log("→ platform schema");
    await sql.unsafe(PLATFORM_DDL);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM platform.user_accounts WHERE is_platform_admin`;
    if (n === 0) {
      const email = process.env.SUPERADMIN_EMAIL;
      if (!email) throw new Error("No platform admin yet: set SUPERADMIN_EMAIL (chart value kara.superAdmin.email).");
      const hash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
      await sql`
        INSERT INTO platform.user_accounts (email, password_hash, full_name, is_platform_admin)
        VALUES (${email}, ${hash}, ${process.env.SUPERADMIN_NAME ?? "مدیر سیمرغ‌کارا"}, true)
      `;
      console.log(`→ first platform admin: ${email}`);
    }
  } finally {
    await sql.end();
  }
  console.log("→ tenant schemas");
  const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "migrate.ts")], { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
