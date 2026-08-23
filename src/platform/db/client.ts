import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createDbPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool });
}

export async function checkDbConnection(pool: pg.Pool): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

const REQUIRED_COLUMNS: Array<{ table: string; column: string; migration: string }> = [
  { table: "resolution_results", column: "contingency", migration: "0027_transitive_bounding.sql" },
  { table: "resolution_results", column: "derivation_depth", migration: "0027_transitive_bounding.sql" },
];

export async function validateSchema(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    for (const { table, column, migration } of REQUIRED_COLUMNS) {
      const result = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );
      if (result.rows.length === 0) {
        throw new Error(
          `Schema out of date: column "${table}.${column}" does not exist. ` +
          `Run migrations (npm run db:migrate) — required migration: ${migration}`,
        );
      }
    }
  } finally {
    client.release();
  }
}
