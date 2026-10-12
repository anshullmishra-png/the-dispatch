import "./_env";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { toDirectUrl } from "@/lib/db";
import { requireEnv } from "@/lib/env";

// Schema changes go over the direct connection, not PgBouncer (Neon guidance).
async function main() {
  const { DATABASE_URL } = requireEnv("DATABASE_URL");
  const pool = new Pool({ connectionString: toDirectUrl(DATABASE_URL) });
  const started = Date.now();
  try {
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
    const { rows } = await pool.query<{ count: string }>(
      "select count(*) from drizzle.__drizzle_migrations",
    );
    console.log(`migrations applied: ${rows[0]?.count ?? "?"} total (${Date.now() - started} ms)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
