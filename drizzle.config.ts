import { defineConfig } from "drizzle-kit";

// Used for `drizzle-kit generate` only (no DB connection needed).
// Migrations are applied by scripts/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  strict: true,
  verbose: true,
});
