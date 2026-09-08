#!/usr/bin/env node
/**
 * Mailbox verification pass over the outreach queue (layer 3).
 *
 * Takes the leads that are NEXT in line to be emailed, opens SMTP to their MX
 * and drops only the mailboxes that answer with an explicit 5xx. Everything
 * inconclusive (timeout, greylist, catch-all, provider that blocks probes) is
 * left untouched — a false positive costs a real lead.
 *
 * Must run where port 25 egress works (a laptop/VPS, NOT Vercel).
 *
 * Usage:  DRY=1 npx tsx scripts/verify-queue.mjs [limit]
 *         npx tsx scripts/verify-queue.mjs 2000
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const v = env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (v && !process.env[k]) process.env[k] = v;
}
const { verifyMailbox } = await import("../lib/smtpVerify.ts");
const { quarantineEmail } = await import("../lib/emailScrub.ts");
const { pool } = await import("../lib/db.ts");

const LIMIT = parseInt(process.argv[2] || "500", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "8", 10);
const DRY = process.env.DRY === "1";

// The queue, in the order the barrels will actually pick it up: untouched leads
// first, newest contacts first (they were never validated by a real send).
const { rows } = await pool.query(
  `SELECT email, src FROM (
     SELECT LOWER(email) email, 'sc' src, harvested_at ts FROM sc_artists
      WHERE email IS NOT NULL AND COALESCE(sc_touch,0)=0 AND (lead_status IS NULL OR lead_status='New')
        AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')
     UNION ALL
     SELECT LOWER(TRIM(value)), 'bp', created_at FROM artist_contacts
      WHERE type='email' AND COALESCE(status,'ok')='ok'
     UNION ALL
     SELECT LOWER(email), 'radar', created_at FROM radar_leads
      WHERE email IS NOT NULL AND COALESCE(touch,0)=0 AND COALESCE(status,'new') IN ('new','queued')
        AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')
     UNION ALL
     SELECT LOWER(email), 'sp', created_at FROM spotify_leads
      WHERE email IS NOT NULL AND COALESCE(sp_touch,0)=0 AND (lead_status IS NULL OR lead_status='New')
   ) q
   WHERE email NOT IN (SELECT LOWER(email) FROM email_blacklist)
   ORDER BY ts DESC NULLS LAST
   LIMIT $1`,
  [LIMIT]
);

console.log(`${DRY ? "[DRY] " : ""}verifying ${rows.length} queued mailboxes (concurrency ${CONCURRENCY})`);
const counts = { invalid: 0, valid: 0, catch_all: 0, unknown: 0 };
const samples = [];
const t0 = Date.now();
let idx = 0;

async function worker() {
  while (idx < rows.length) {
    const row = rows[idx++];
    const r = await verifyMailbox(row.email).catch(() => ({ email: row.email, verdict: "unknown" }));
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    if (r.verdict === "invalid") {
      if (samples.length < 12) samples.push(`${row.src} ${r.email} — ${r.note ?? ""}`);
      if (!DRY) await quarantineEmail(r.email, `smtp: mailbox does not exist (${r.note ?? "5xx"})`);
    }
    if (idx % 100 === 0) process.stdout.write(`  …${idx}/${rows.length} invalid=${counts.invalid}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\ndone in ${secs}s`);
console.table(counts);
const judged = counts.invalid + counts.valid + counts.catch_all;
console.log(`dead-mailbox rate among judged: ${judged ? ((100 * counts.invalid) / judged).toFixed(1) : "0"}%  (unknown/skipped: ${counts.unknown})`);
for (const s of samples) console.log("  ", s);
await pool.end().catch(() => {});
