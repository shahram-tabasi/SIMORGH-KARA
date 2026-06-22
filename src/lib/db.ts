import "server-only";
import postgres from "postgres";

/**
 * Single shared connection pool. We achieve tenant isolation through
 * separate PostgreSQL *schemas* (one per company) and switch the active
 * schema per-request using `SET LOCAL search_path` inside a transaction.
 *
 * Using SET LOCAL (transaction-scoped) is the safe way to do schema-per-tenant
 * with a pooled connection: the search_path is reset automatically when the
 * transaction ends, so it never leaks into another tenant's request.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

declare global {
  // eslint-disable-next-line no-var
  var __simorghSql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  global.__simorghSql ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    // The platform (control-plane) tables live in the `platform` schema.
    // We always keep `platform` reachable on the search_path.
    connection: {
      search_path: "platform,public",
    },
  });

if (process.env.NODE_ENV !== "production") {
  global.__simorghSql = sql;
}

/** A schema name is safe if it matches our generated pattern. */
const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

export function assertSafeSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Unsafe tenant schema name: ${schema}`);
  }
  return schema;
}

/**
 * Run a callback with the active search_path pointed at a tenant schema.
 * All queries inside the callback see the tenant's tables first, then
 * `platform` (for cross-schema lookups) and `public`.
 */
export async function withTenant<T>(
  schema: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const safe = assertSafeSchema(schema);
  // postgres.js types `begin` as returning UnwrapPromiseArray<T>; our callback
  // may return a non-array value, so we assert the concrete result type.
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${safe}", platform, public`);
    return fn(tx as Tx);
  }) as Promise<T>;
}

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
