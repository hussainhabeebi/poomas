# Database: Cloudflare D1

The API's database moved from Neon Postgres to **Cloudflare D1** (SQLite), so the
whole backend now runs on Cloudflare: Workers, D1, KV, R2, Queues and Durable Objects.
There are two D1 databases: `poomas-db` (binding `DB`, everything) and `poomas-logs`
(binding `LOGS_DB`, supplier/email logs and agency activity, `packages/db/src/logs`).

- Schema: `packages/db/src/schema` (Drizzle `sqlite-core`)
- Migrations: `packages/db/migrations` (applied by wrangler; tracked in D1's `d1_migrations` table)
- Binding: `DB` in `apps/api/wrangler.toml`
- The old Postgres migrations are kept for reference in `packages/db/drizzle/postgres-legacy`.

## One-time switch-over

1. **Database + tables are automatic.** On every push to `main` the deploy workflow
   creates `poomas-db` if it doesn't exist, fills its id into `wrangler.toml` and applies
   the migrations. The `CLOUDFLARE_API_TOKEN` secret needs **D1 Edit** permission.

2. *(Only for running commands from your machine)* put the id from
   `wrangler d1 list` into `apps/api/wrangler.toml` (`REPLACE_WITH_D1_DATABASE_ID`).

3. **Copy the data from Neon.** Neon must answer queries for this step: while the
   project is over its quota, wait for the monthly reset or upgrade for one day.

   ```bash
   DATABASE_URL='postgres://…neon.tech/…' pnpm --filter @poomas/db export:neon
   pnpm --filter @poomas/db import:sql
   cd apps/api && pnpm exec wrangler d1 execute poomas-db --remote --file=../../packages/db/neon-import.sql
   ```

   The import replaces the seed rows with the real data (same ids, so existing
   sessions and links keep working).

4. Remove the old
   secret: `pnpm exec wrangler secret delete DATABASE_URL`. The Hyperdrive config
   can also be deleted in the Cloudflare dashboard.

## Day to day

| Task | Command |
| --- | --- |
| Change the schema | edit `packages/db/src/schema/*`, then `pnpm db:generate` |
| Apply migrations (prod) | `pnpm db:migrate` (CI also does this on every deploy) |
| Local dev database | `pnpm db:migrate:local`, then `pnpm --filter @poomas/api dev` |
| Run SQL | `pnpm --filter @poomas/api exec wrangler d1 execute poomas-db --remote --command "select …"` |
| Backups | D1 Time Travel: `wrangler d1 time-travel restore poomas-db --timestamp=…` (30 days) |

## Notes for writing queries

- Timestamps are ISO-8601 UTC text; Drizzle returns `Date`. Compare with `gte(col, date)`.
  In raw `sql\`\`` pass `date.toISOString()`, not a `Date`.
- Money columns are returned as fixed-2dp strings like before; raw `sum()` results are numbers,
  so wrap them as `printf('%.2f', coalesce(sum(x), 0))` when a string is expected.
- JSON fields: `col->>'key'` works the same as in Postgres.
- D1 allows **100 bound parameters per statement**: use `inList(col, ids)` instead of
  `inArray` for lists of unknown size, and `insertMany(db, table, rows)` for multi-row inserts.
- No `ILIKE` (SQLite `LIKE` is already case-insensitive for ASCII), no `::casts`, no `~` regex.
