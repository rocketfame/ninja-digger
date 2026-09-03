#!/usr/bin/env node
/**
 * One-off / on-demand junk scrub of every lead table using the single policy
 * in lib/emailJunk.ts (same code the crons use). Junk goes to email_blacklist
 * (suppression list) and the lead rows are marked email_status/status='junk'.
 *
 * Usage:  DRY=1 npx tsx scripts/scrub-junk-emails.mjs   # report only
 *         npx tsx scripts/scrub-junk-emails.mjs         # apply
 * Needs DATABASE_URL (or DATABASE_URL_UNPOOLED) in .env.local.
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const v = env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (v && !process.env[k]) process.env[k] = v;
}
const { scrubJunkEmails } = await import("../lib/emailScrub.ts");
const { pool } = await import("../lib/db.ts");

const dry = process.env.DRY === "1";
const t0 = Date.now();
const r = await scrubJunkEmails({ dry });
console.log(`${dry ? "[DRY] " : ""}scanned ${r.scanned} live emails → junk ${r.junk} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.table(r.byReason);
for (const s of r.samples) console.log("  ", s);
await pool.end().catch(() => {});
