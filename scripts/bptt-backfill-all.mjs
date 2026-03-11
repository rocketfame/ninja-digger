#!/usr/bin/env node
/**
 * Backfill BPTT for ALL genres and date range.
 * Run: node scripts/bptt-backfill-all.mjs [dateFrom] [dateTo]
 * Default: last 7 days.
 * Requires dev server: npm run dev
 */
import "dotenv/config";

const dateTo = process.argv[3] || new Date().toISOString().slice(0, 10);
const from = new Date();
from.setDate(from.getDate() - 7);
const dateFrom = process.argv[2] || from.toISOString().slice(0, 10);

const url = "http://localhost:3000/api/internal/bptoptracker/backfill";
console.log("Backfill BPTT all genres:", dateFrom, "—", dateTo);
console.log("POST", url, "\n");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    genreSlug: "__all__",
    dateFrom,
    dateTo,
  }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Error:", res.status, json.error || res.statusText);
  process.exit(1);
}
console.log(JSON.stringify(json, null, 2));
if (json.sync?.chartEntriesInserted > 0) {
  console.log("\n✓ Дані оновлено. Перезавантаж /leads");
}
