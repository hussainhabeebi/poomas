import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client.js";

// D1 allows at most 100 bound parameters per statement. These helpers keep
// queries with caller-sized lists under that limit.

/** `column IN (...)` for a list of any length: binds one JSON parameter instead of one per value. */
export function inList(column: SQLWrapper, values: readonly (string | number)[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}

/** Multi-row insert split into small statements so the bound-parameter count stays low. */
export async function insertMany<T extends SQLiteTable>(db: Db, table: T, rows: T["$inferInsert"][], rowsPerStatement = 4) {
  for (let i = 0; i < rows.length; i += rowsPerStatement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(rows.slice(i, i + rowsPerStatement) as any);
  }
}
