import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index.js";

// Cloudflare D1 (SQLite at the edge). Pass the Worker's D1 binding (env.DB).
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
