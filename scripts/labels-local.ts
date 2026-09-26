/**
 * Local label worker (launchd: com.ninjadigger.labels-local, every 30 min and
 * on wake). Does what the Vercel cron cannot or does too slowly: a fast drain
 * of the label queue, Discogs at its own pace, and the SMTP layer (port 25 is
 * closed on Vercel).
 *
 * Built to be cut off at any moment — the owner closes the laptop whenever:
 *   - every label's state is written as soon as it is processed, so an
 *     interrupted run loses only the rows in flight; they stay 'new' / un-
 *     crawled / 'pending' and the next run picks them up;
 *   - a run is time-boxed (25 min) and a watchdog kills it at 28, so a run
 *     that wakes up on dead sockets after sleep never blocks the next one;
 *   - it holds the cron's lease while working, so the Vercel cron skips.
 *
 * Usage: npx tsx --env-file=.env.local scripts/labels-local.ts
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
const sh = promisify(exec);
import { resolveBatch, crawlBatch, discogsBatch, gradeLabels } from "../lib/labels";
import { acquireLease } from "../lib/cronLock";
import { pool } from "../lib/db";

const RUN_MS = 25 * 60e3;
const t0 = Date.now();
const left = () => RUN_MS - (Date.now() - t0);
const stamp = () => new Date().toLocaleTimeString("uk-UA");

setTimeout(() => { console.log(stamp(), "watchdog: run exceeded 28 min, exiting"); process.exit(2); }, 28 * 60e3).unref();

async function queue() {
  return (await pool.query<{ nw: number; tocrawl: number; pend: number; a: number; b: number }>(
    `SELECT COUNT(*) FILTER (WHERE status='new')::int nw,
            COUNT(*) FILTER (WHERE status='resolved' AND crawled_at IS NULL AND website IS NOT NULL)::int tocrawl,
            (SELECT COUNT(*) FROM label_db_emails WHERE verdict='pending')::int pend,
            COUNT(*) FILTER (WHERE grade='A')::int a, COUNT(*) FILTER (WHERE grade='B')::int b
       FROM label_db`
  )).rows[0];
}

let drainDone = false;

async function drain() {
  for (let round = 1; left() > 3 * 60e3; round++) {
    await acquireLease("labels", 0); // the Vercel cron (6-min lease) skips while we work
    const q0 = await queue();
    if (q0.nw === 0 && q0.tocrawl === 0) break;
    const r = await resolveBatch(300);
    const c = await crawlBatch(300, undefined, 15);
    await gradeLabels();
    const q = await queue();
    console.log(stamp(), `r${round}`, JSON.stringify({ r, c }), `| queue ${q.nw} tocrawl ${q.tocrawl} | A ${q.a} B ${q.b} | SMTP pending ${q.pend}`);
  }
  drainDone = true;
}

async function discogs() {
  while (left() > 2 * 60e3) {
    const d = await discogsBatch(30);
    if (!("checked" in d) || d.checked === 0) break;
  }
}

/** SMTP in parallel with the drain, in slices, so it keeps up with what the drain finds. */
async function smtp() {
  while (left() > 60e3) {
    const { pend } = await queue();
    if (pend === 0) {
      if (drainDone) return;
      await new Promise((r) => setTimeout(r, 60e3));
      continue;
    }
    try {
      const { stdout } = await sh("npx tsx scripts/verify-labels.mjs 1500 2>&1 | tail -1", { timeout: Math.max(60e3, left()) });
      console.log(stamp(), "SMTP:", stdout.trim());
    } catch (e) { console.log(stamp(), "SMTP stopped:", String(e).slice(0, 100)); return; }
  }
}

(async () => {
  const q = await queue();
  console.log(`=== ${new Date().toLocaleString("uk-UA")} | queue ${q.nw} tocrawl ${q.tocrawl} SMTP pending ${q.pend}`);
  if (q.nw === 0 && q.tocrawl === 0 && q.pend === 0) { console.log("nothing to do"); await pool.end(); return; }
  await Promise.all([drain(), discogs(), smtp()]);
  await gradeLabels();
  await pool.end();
})().catch(async (e) => { console.log(stamp(), "error:", String(e).slice(0, 200)); process.exit(1); });
