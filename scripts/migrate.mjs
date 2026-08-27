#!/usr/bin/env node
/**
 * Runs all *.sql in migrations/ in order. Invoked automatically during Vercel build.
 * Requires DATABASE_URL in environment.
 */
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const migrationsDir = join(root, "migrations");

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Migrations skipped: DATABASE_URL not set.");
  process.exit(0);
}
connectionString = connectionString
  .replace(/([?&])sslmode=require\b/gi, "$1sslmode=verify-full")
  .replace(/([?&])sslmode=prefer\b/gi, "$1sslmode=verify-full")
  .replace(/([?&])sslmode=verify-ca\b/gi, "$1sslmode=verify-full");

const pool = new pg.Pool({ connectionString });

function logTables(sql) {
  const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
  let m;
  while ((m = createTableRe.exec(sql)) !== null) {
    console.log(`Creating table ${m[1]}`);
  }
}

async function run() {
  // Track applied migrations so we don't re-run all of them on every build
  // (a non-idempotent migration re-run could error or duplicate data).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  const applied = new Set(
    (await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name)
  );

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // First run against an existing DB: schema is already live (migrations were
  // applied ad hoc), so record everything as applied and run nothing — avoids
  // re-executing dozens of migrations. New files added later run normally.
  if (applied.size === 0 && files.length > 0) {
    for (const f of files) {
      await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
    }
    await pool.end();
    console.log(`Initialized migration tracking with ${files.length} existing migration(s); nothing to run.`);
    return;
  }

  const pending = files.filter((f) => !applied.has(f));
  console.log(`${files.length} migration(s), ${pending.length} pending.`);
  for (const file of pending) {
    const path = join(migrationsDir, file);
    const sql = await readFile(path, "utf-8");
    console.log(`Applying: ${file}`);
    logTables(sql);
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
  }

  await pool.end();
  console.log("Migrations complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
