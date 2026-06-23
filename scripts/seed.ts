/**
 * Initializes the control-plane schema and the bootstrap super-admin account.
 * Run with:  npm run db:seed
 * (package.json loads .env via `node --env-file=.env`)
 */
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PLATFORM_DDL } from "../src/lib/sql";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const email = process.env.SUPERADMIN_EMAIL ?? "admin@simorgh.local";
  const password = process.env.SUPERADMIN_PASSWORD ?? "ChangeMe123!";
  const name = process.env.SUPERADMIN_NAME ?? "مدیر سیمرغ";

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    console.log("→ applying platform schema…");
    await sql.unsafe(PLATFORM_DDL);

    const hash = await bcrypt.hash(password, 10);
    console.log("→ creating / updating super admin:", email);
    await sql`
      INSERT INTO platform.user_accounts (email, password_hash, full_name, is_platform_admin)
      VALUES (${email}, ${hash}, ${name}, true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            full_name = EXCLUDED.full_name,
            is_platform_admin = true
    `;

    console.log("\n✔ Seed complete.");
    console.log("  Super admin login:");
    console.log("   email:", email);
    console.log("   password:", password);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
