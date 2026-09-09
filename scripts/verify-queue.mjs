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
 *         CONCURRENCY=12 CHUNK=250 npx tsx scripts/verify-queue.mjs 30000
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const v = env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (v && !process.env[k]) process.env[k] = v;
}
const { verifyBatchOnHost, allMx } = await import("../lib/smtpVerify.ts");
const { OPENED_SQL, REPLIED_SQL, SUPPRESSED_SQL, contactableSql, leadSourcesSql } = await import("../lib/leadPolicy.ts");
const { quarantineEmail } = await import("../lib/emailScrub.ts");
const { pool } = await import("../lib/db.ts");

const LIMIT = parseInt(process.argv[2] || "500", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "8", 10);
const DRY = process.env.DRY === "1";
const unresolved = [];

// SEGMENT=engaged|replied verifies the warm segment first — it is what the
// marketing bridge hands over, so it must not wait behind 30k cold addresses.
const SEGMENT = (process.env.SEGMENT || "").toLowerCase();
// Segment definitions come from lib/leadPolicy, the same ones the marketing
// bridge hands over on — this script used to carry its own copy and disagreed.
const SEGMENT_SQL = {
  engaged: `SELECT q.email, q.platform src, q.found_at ts FROM (${leadSourcesSql()}) q
             WHERE q.email IN (${OPENED_SQL})`,
  replied: `SELECT LOWER(email) email, 'reply' src, MAX(created_at) ts FROM tg_notifications
             WHERE email IS NOT NULL GROUP BY 1`,
}[SEGMENT];

// The queue, in the order the barrels will actually pick it up: untouched leads
// first, newest contacts first (they were never validated by a real send).
const { rows } = await pool.query(
  SEGMENT_SQL
    ? `SELECT email, src FROM (${SEGMENT_SQL}) q
        WHERE email NOT IN (${SUPPRESSED_SQL})
          AND email NOT IN (SELECT email FROM email_verification WHERE verdict IN ('valid','invalid'))
        ORDER BY ts DESC NULLS LAST LIMIT $1`
    : `SELECT q.email, q.platform src FROM (${leadSourcesSql()}) q
        WHERE q.touch = 0 AND ${contactableSql("q.email")}
          AND q.email NOT IN (SELECT email FROM email_verification
                               WHERE verdict IN ('valid','invalid') OR checked_at > now() - interval '30 days')
        ORDER BY q.found_at DESC NULLS LAST LIMIT $1`,
  [LIMIT]
);

console.log(`${DRY ? "[DRY] " : ""}verifying ${rows.length} queued mailboxes`);
const counts = { invalid: 0, valid: 0, catch_all: 0, unknown: 0 };
const samples = [];
const srcOf = new Map(rows.map((r) => [r.email, r.src]));
const t0 = Date.now();

// Group by recipient domain, then by MX host: all gmail.com addresses share one
// host, so they are verified over a handful of connections instead of thousands.
const byDomain = new Map();
for (const r of rows) {
  const d = r.email.split("@")[1];
  if (!d) continue;
  if (!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push(r.email);
}
console.log(`  ${byDomain.size} distinct domains`);

const byHost = new Map();
const domains = [...byDomain.keys()];
let resolved = 0;
for (let i = 0; i < domains.length; i += 40) {
  await Promise.all(domains.slice(i, i + 40).map(async (d) => {
    const hosts = await allMx(d);
    resolved++;
    if (hosts.length === 0) { // no MX, or a provider that blocks probes
      for (const e of byDomain.get(d)) unresolved.push(e); // counted once, in record()
      return;
    }
    // Spread a domain's addresses over ALL of its MX hosts. gmail.com alone is
    // ~70% of the base and publishes 5 hosts, so this turns one serial queue
    // into five that can run at once.
    const list = byDomain.get(d);
    for (let j = 0; j < list.length; j++) {
      const host = hosts[j % hosts.length];
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(list[j]);
    }
  }));
  if (i % 400 === 0) process.stdout.write(`  …MX ${resolved}/${domains.length}\n`);
}
console.log(`  ${byHost.size} MX hosts to contact`);

async function record(r) {
  counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  if (DRY) return;
  await pool.query(
    `INSERT INTO email_verification (email, verdict, note, checked_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (email) DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, checked_at = now()`,
    [r.email, r.verdict, (r.note ?? "").slice(0, 200)]
  ).catch(() => {});
  if (r.verdict === "invalid") {
    if (samples.length < 12) samples.push(`${srcOf.get(r.email) ?? "?"} ${r.email} — ${r.note ?? ""}`);
    await quarantineEmail(r.email, `smtp: mailbox does not exist (${r.note ?? "5xx"})`);
  }
}
for (const e of unresolved) await record({ email: e, verdict: "unknown", note: "no MX / provider blocks probes" });

const CHUNK = parseInt(process.env.CHUNK || "250", 10);
const units = [];
for (const [host, emails] of byHost) {
  for (let i = 0; i < emails.length; i += CHUNK) units.push([host, emails.slice(i, i + CHUNK)]);
}
// Biggest hosts first so the long pole starts immediately.
units.sort((a, b) => b[1].length - a[1].length);
console.log(`  ${units.length} work units of <=${CHUNK} addresses`);

let unitIdx = 0, doneCount = 0;
async function hostWorker() {
  while (unitIdx < units.length) {
    const [host, emails] = units[unitIdx++];
    const res = await verifyBatchOnHost(host, emails).catch(() => emails.map((e) => ({ email: e, verdict: "unknown" })));
    for (const r of res) await record(r);
    doneCount += emails.length;
    const pct = ((100 * doneCount) / rows.length).toFixed(1);
    process.stdout.write(`  …${doneCount}/${rows.length} (${pct}%) invalid=${counts.invalid} (${host.slice(0, 34)})\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, hostWorker));

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\ndone in ${secs}s`);
console.table(counts);
const judged = counts.invalid + counts.valid + counts.catch_all;
console.log(`dead-mailbox rate among judged: ${judged ? ((100 * counts.invalid) / judged).toFixed(1) : "0"}%  (unknown/skipped: ${counts.unknown})`);
for (const s of samples) console.log("  ", s);
await pool.end().catch(() => {});
