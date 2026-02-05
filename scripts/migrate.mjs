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
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);
  for (const file of files) {
    const path = join(migrationsDir, file);
    const sql = await readFile(path, "utf-8");
    console.log(`Migration: ${file}`);
    logTables(sql);
    await pool.query(sql);
  }

  await pool.end();
  console.log("Migrations complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
