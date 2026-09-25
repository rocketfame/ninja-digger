#!/usr/bin/env node
/**
 * SMTP layer for the label database: every label address that passed the
 * server-side filters (verdict 'pending') is probed at its MX. Same rule as
 * verify-queue: only an explicit 5xx about the mailbox kills an address;
 * greylist, timeout, catch-all or a provider that blocks probes stay alive.
 * Dead mailboxes also go to email_blacklist, so no channel ever mails them.
 *
 * Must run where port 25 egress works (this Mac, NOT Vercel).
 * Usage:  npx tsx scripts/verify-labels.mjs [limit]      (DRY=1 — preview)
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const v = env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (v && !process.env[k]) process.env[k] = v;
}
const { verifyMailbox } = await import("../lib/smtpVerify.ts");
const { quarantineEmail } = await import("../lib/emailScrub.ts");
const { gradeLabels } = await import("../lib/labels.ts");
const { pool } = await import("../lib/db.ts");

const LIMIT = parseInt(process.argv[2] || "2000", 10);
const DRY = process.env.DRY === "1";
// Re-check addresses that were inconclusive a month ago: a greylist clears.
const { rows } = await pool.query(
  `SELECT DISTINCT email FROM label_db_emails
    WHERE verdict = 'pending' OR (verdict IN ('unknown','catch_all') AND checked_at < now() - interval '30 days')
    LIMIT $1`, [LIMIT]
);
console.log(`${DRY ? "[DRY] " : ""}verifying ${rows.length} label mailboxes`);

const counts = { valid: 0, invalid: 0, catch_all: 0, unknown: 0 };
const queue = rows.map((r) => r.email);
async function worker() {
  for (let e = queue.shift(); e; e = queue.shift()) {
    const r = await verifyMailbox(e).catch(() => ({ email: e, verdict: "unknown", note: "error" }));
    counts[r.verdict]++;
    if (DRY) continue;
    await pool.query(
      `UPDATE label_db_emails SET verdict=$2, reject_reason=$3, checked_at=now() WHERE email=$1`,
      [e, r.verdict, r.verdict === "invalid" ? `smtp: ${r.note ?? "5xx"}`.slice(0, 200) : null]
    );
    if (r.verdict === "invalid") await quarantineEmail(e, `smtp: mailbox does not exist (${r.note ?? "5xx"})`);
  }
}
await Promise.all(Array.from({ length: parseInt(process.env.CONCURRENCY || "6", 10) }, worker));
if (!DRY) await gradeLabels();
console.log(counts);
await pool.end();
