/**
 * POST /api/internal/db/cleanup — efficient, aggressive space reclaim.
 *
 * Neon free tier caps at 512MB. DELETE leaves dead tuples (size doesn't drop
 * until VACUUM FULL); TRUNCATE and DROP release the files immediately — so we
 * prefer them for the heavy junk:
 *   - url_cache: regenerable HTML cache, the #1 bloat source → TRUNCATE
 *   - dead tables (removed RA feed, dated one-off archives) → DROP
 *   - stale rows past retention → DELETE (bounded)
 *
 * Idempotent and safe to run on a schedule. GET returns a dry-run report.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Tables that no longer back any code path (verified: zero references).
const DEAD_TABLE_PATTERNS = ["ra_events"];
const DEAD_TABLE_LIKE = ["artist_metrics_archive_%"]; // dated one-off backups

async function dbSizeMB(): Promise<number> {
  const r = await pool.query<{ mb: number }>(
    `SELECT (pg_database_size(current_database())/1048576.0)::numeric(10,1) AS mb`
  );
  return Number(r.rows[0].mb);
}

export async function GET() {
  const tables = (await pool.query<{ name: string; mb: number }>(
    `SELECT relname AS name, (pg_total_relation_size(c.oid)/1048576.0)::numeric(10,1) AS mb
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
     ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`
  )).rows.map((x) => ({ name: x.name, mb: Number(x.mb) }));
  // Diagnostic: did the broken status constraint stall the outreach state
  // machine? Status spread + how many leads got touch-1 more than once (spam).
  const leadStatus = (await pool.query<{ status: string; c: number }>(
    `SELECT status, COUNT(*)::int c FROM lead_profiles GROUP BY status ORDER BY c DESC`
  ).catch(() => ({ rows: [] }))).rows;
  const repeatT1 = (await pool.query<{ leads: number; total_sends: number }>(
    `SELECT COUNT(*)::int leads, COALESCE(SUM(n),0)::int total_sends FROM (
       SELECT artist_beatport_id, COUNT(*) n FROM outreach_events
       WHERE template_id='email_touch_1' GROUP BY artist_beatport_id HAVING COUNT(*) > 1
     ) x`
  ).catch(() => ({ rows: [{ leads: 0, total_sends: 0 }] }))).rows[0];
  return NextResponse.json({ ok: true, dbSizeMB: await dbSizeMB(), tables, leadStatus, repeatT1 });
}

export async function POST() {
  const before = await dbSizeMB();
  const actions: Record<string, unknown> = {};

  // 1. Nuke the regenerable HTML cache outright (biggest, safest win).
  await pool.query(`TRUNCATE url_cache`).then(() => { actions.url_cache = "truncated"; }).catch((e) => { actions.url_cache = String(e).slice(0, 80); });

  // 2. Drop dead tables (exact names + dated-archive pattern), files freed now.
  const drops: string[] = [...DEAD_TABLE_PATTERNS];
  for (const like of DEAD_TABLE_LIKE) {
    const rows = (await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE $1`, [like]
    )).rows;
    drops.push(...rows.map((r) => r.relname));
  }
  const dropped: string[] = [];
  for (const t of drops) {
    // identifier is derived from pg_class / a fixed allowlist, not user input
    await pool.query(`DROP TABLE IF EXISTS "${t}" CASCADE`).then(() => dropped.push(t)).catch(() => {});
  }
  actions.dropped = dropped;

  // 3. Bounded retention delete for the heavy Beatport tables (56 days).
  // Purge junk emails: Bandcamp subdomains (not real mailboxes) + generic system
  // /support role addresses (never a real lead). Legit music roles like booking@,
  // management@, info@ are kept.
  const jb = await pool.query(
    `UPDATE sc_artists SET email=NULL, email_source=NULL
     WHERE email ILIKE '%bandcamp.com'
        OR email ~* '^(support|help|admin|webmaster|postmaster|abuse|hostmaster|billing|noc|sysadmin|security|privacy|feedback|no-?reply)@'`
  ).catch(() => ({ rowCount: 0 }));
  actions.junkEmailsCleaned = jb.rowCount ?? 0;

  const c1 = await pool.query(`DELETE FROM chart_entries WHERE snapshot_date < CURRENT_DATE - 56`).catch(() => ({ rowCount: 0 }));
  const c2 = await pool.query(`DELETE FROM bptoptracker_daily WHERE snapshot_date < CURRENT_DATE - 56`).catch(() => ({ rowCount: 0 }));
  actions.retentionDeleted = { chart_entries: c1.rowCount ?? 0, bptoptracker_daily: c2.rowCount ?? 0 };

  const after = await dbSizeMB();
  return NextResponse.json({ ok: true, beforeMB: before, afterMB: after, freedMB: Number((before - after).toFixed(1)), actions });
}
