import { drizzle } from "drizzle-orm/d1";
import * as logsSchema from "./schema.js";

type D1 = Parameters<typeof drizzle>[0];

// Logs database (Cloudflare D1). Returns null when the Worker has no LOGS_DB binding:
// log writes are then skipped and log views come back empty — never a request failure.
export function createLogsDb(d1: D1 | undefined | null) {
  return d1 ? drizzle(d1, { schema: logsSchema }) : null;
}

export type LogsDb = NonNullable<ReturnType<typeof createLogsDb>>;
export { logsSchema };
