/**
 * Applies incremental schema changes to every existing tenant schema.
 * Idempotent — safe to run repeatedly. Run with:  npm run db:migrate
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const sql = postgres(url, { max: 1 });
  try {
    const tenants = await sql<{ schema_name: string }[]>`
      SELECT schema_name FROM platform.companies
    `;
    for (const { schema_name } of tenants) {
      if (!/^tenant_[a-z0-9_]+$/.test(schema_name)) continue;
      console.log("→ migrating", schema_name);

      // kartabl_items.created_by — assigner tracking for the accountability model
      await sql.unsafe(`
        ALTER TABLE "${schema_name}".kartabl_items
          ADD COLUMN IF NOT EXISTS created_by uuid
          REFERENCES "${schema_name}".members(id) ON DELETE SET NULL;
      `);
      // Backfill existing self-created items so their owner can still edit them.
      await sql.unsafe(`
        UPDATE "${schema_name}".kartabl_items i
        SET created_by = k.member_id
        FROM "${schema_name}".kartabls k
        WHERE i.kartabl_id = k.id AND i.created_by IS NULL;
      `);
    }
    console.log("✔ Migration complete.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
