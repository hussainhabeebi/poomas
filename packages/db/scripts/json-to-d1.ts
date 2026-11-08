// One-time: turn the Neon JSON export (scripts/neon-export.sh) into a SQL file for D1.
// Values go through each Drizzle column's own encoder, so timestamps become ISO text,
// booleans 0/1, decimals numbers and json/text[] JSON text — exactly what the app writes.
//
//   pnpm --filter @poomas/db import:sql
//   pnpm --filter @poomas/api exec wrangler d1 execute poomas-db --remote --file=../../packages/db/neon-import.sql
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../src/schema/index.js";

const dir = join(import.meta.dirname, "..", "neon-export");
const tables = Object.values(schema).filter((v): v is SQLiteTable => is(v, SQLiteTable)).map((t) => getTableConfig(t));

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out: string[] = ["PRAGMA defer_foreign_keys = true;"];
// Replace whatever the seed migration created with the real data.
for (const t of [...tables].reverse()) out.push(`DELETE FROM "${t.name}";`);

let total = 0;
for (const t of tables) {
  const file = join(dir, `${t.name}.json`);
  if (!existsSync(file)) { console.warn(`skip ${t.name}: no export file`); continue; }
  const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
  for (const row of rows) {
    const cols: string[] = [], vals: string[] = [];
    for (const col of t.columns) {
      if (!(col.name in row)) continue;
      const raw = row[col.name];
      cols.push(`"${col.name}"`);
      vals.push(raw === null ? "NULL" : lit(col.mapToDriverValue(raw)));
    }
    const stmt = `INSERT INTO "${t.name}" (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
    if (stmt.length > 100_000) console.warn(`warning: ${t.name} row ${String(row.id)} is ${stmt.length} bytes (D1 max statement size is 100 KB)`);
    out.push(stmt);
  }
  total += rows.length;
  console.log(`${t.name}: ${rows.length} rows`);
}

writeFileSync(join(import.meta.dirname, "..", "neon-import.sql"), out.join("\n") + "\n");
console.log(`Wrote neon-import.sql (${total} rows).`);
