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
