/**
 * Junk-email quarantine: one place that (a) puts an address on the suppression
 * list (email_blacklist — every sender barrel already honours it) and (b) marks
 * the owning lead rows so UI/reports show why. Used by the pre-send check in
 * every barrel, the weekly hygiene cron and the one-off scrub script.
 */
import { pool } from "@/lib/db";
import { classifyEmail } from "@/lib/emailJunk";

export async function quarantineEmail(email: string, reason: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const r = reason.slice(0, 120);
  await pool.query(`INSERT INTO email_blacklist (email, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [e, `junk: ${r}`]).catch(() => {});
  await pool.query(`UPDATE sc_artists SET email_status='junk', updated_at=now() WHERE LOWER(email)=$1 AND COALESCE(email_status,'') NOT IN ('bounced','unsub')`, [e]).catch(() => {});
  await pool.query(`UPDATE spotify_leads SET email_status='junk', updated_at=now() WHERE LOWER(email)=$1 AND COALESCE(email_status,'') NOT IN ('bounced','unsub')`, [e]).catch(() => {});
  await pool.query(`UPDATE radar_leads SET email_status='junk', updated_at=now() WHERE LOWER(email)=$1 AND COALESCE(email_status,'') NOT IN ('bounced','unsub')`, [e]).catch(() => {});
  // artist_contacts.status is constrained to ok/bounced/blocked — 'blocked' is its suppression state.
  await pool.query(`UPDATE artist_contacts SET status='blocked' WHERE type='email' AND LOWER(TRIM(value))=$1 AND COALESCE(status,'ok') NOT IN ('bounced','blocked')`, [e]).catch((err) => console.error("[emailScrub] artist_contacts mark failed:", err instanceof Error ? err.message : err));
}

export type ScrubReport = { scanned: number; junk: number; byReason: Record<string, number>; samples: string[] };

/**
 * Scan every live (not bounced/unsub/blacklisted) email in the four lead
 * tables, classify, and quarantine the junk. Idempotent. `dry` only reports.
 */
export async function scrubJunkEmails(opts: { dry?: boolean; limitPerTable?: number } = {}): Promise<ScrubReport> {
  const lim = opts.limitPerTable ?? 100000;
  const sources = [
    `SELECT LOWER(email) e FROM sc_artists WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk') LIMIT ${lim}`,
    `SELECT LOWER(email) e FROM spotify_leads WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk') LIMIT ${lim}`,
    `SELECT LOWER(email) e FROM radar_leads WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk') LIMIT ${lim}`,
    `SELECT LOWER(TRIM(value)) e FROM artist_contacts WHERE type='email' AND COALESCE(status,'ok') NOT IN ('bounced','blocked','junk') LIMIT ${lim}`,
  ];
  const seen = new Set<string>();
  const junk: { email: string; reason: string }[] = [];
  for (const sql of sources) {
    const rows = await pool.query<{ e: string }>(sql).then((r) => r.rows).catch(() => []);
    for (const { e } of rows) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      const v = classifyEmail(e);
      if (!v.ok) junk.push({ email: e, reason: v.reason });
    }
  }
  const byReason: Record<string, number> = {};
  for (const j of junk) {
    const key = j.reason.replace(/\s*\(.*\)$/, "");
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  if (!opts.dry) {
    for (const j of junk) await quarantineEmail(j.email, j.reason);
  }
  return { scanned: seen.size, junk: junk.length, byReason, samples: junk.slice(0, 15).map((j) => `${j.email} — ${j.reason}`) };
}
