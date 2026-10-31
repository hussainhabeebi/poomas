#!/usr/bin/env bash
# drizzle-kit cannot resolve the schema's ESM ".js" import specifiers, so generate
# from a temporary copy with them stripped. Usage: pnpm db:generate [--name my_change]
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=.drizzle-schema-tmp
trap 'rm -rf "$tmp"' EXIT
rm -rf "$tmp" && mkdir -p "$tmp"
cp src/schema/*.ts "$tmp/"
sed -i.bak 's/\.js";/";/' "$tmp"/*.ts && rm -f "$tmp"/*.bak
cat > "$tmp/drizzle.config.ts" <<CFG
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./$tmp/index.ts", out: "./migrations", dialect: "sqlite", strict: true });
CFG
drizzle-kit generate --config "$tmp/drizzle.config.ts" "$@"
