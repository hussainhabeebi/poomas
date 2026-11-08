import { defineConfig } from "drizzle-kit";

// Cloudflare D1 (SQLite). Generate a migration: `pnpm db:generate`
// Apply it:                                   `pnpm db:migrate`
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "sqlite",
  verbose: true,
  strict: true,
});
