/**
 * DANGER: drops the platform schema and every tenant schema (tenant_*).
 * Run with:  npm run db:reset
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const schemas = await sql<{ schema_name: string }[]>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = 'platform' OR schema_name LIKE 'tenant_%'
    `;
    for (const { schema_name } of schemas) {
      console.log("→ dropping schema", schema_name);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema_name}" CASCADE`);
    }
    console.log("✔ Reset complete. Run `npm run db:seed` to re-bootstrap.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
