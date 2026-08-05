import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function runMigrations(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required to run migrations");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const db = drizzle({ client: pool });

  console.log("Running migrations...");
  try {
    await migrate(db, {
      migrationsFolder: new URL("./migrations", import.meta.url).pathname,
    });
    console.log("Migrations complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void runMigrations();
