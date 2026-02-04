#!/usr/bin/env node
/**
 * Запуск міграцій: виконує всі *.sql у migrations/ по алфавіту.
 * Потрібен DATABASE_URL у .env або в середовищі.
 */
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const migrationsDir = join(root, "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Помилка: DATABASE_URL не встановлено. Скопіюйте .env.example → .env");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function run() {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const path = join(migrationsDir, file);
    const sql = await readFile(path, "utf-8");
    console.log(`Міграція: ${file}`);
    await pool.query(sql);
  }

  await pool.end();
  console.log("Міграції виконано.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
