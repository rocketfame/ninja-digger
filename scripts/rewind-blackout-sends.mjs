#!/usr/bin/env node
/**
 * Rewind leads that were "touched" during the Brevo delivery blackout
 * (2026-08-30 12:41 UTC → now, sender brevo1): Brevo's SMTP relay accepted the
 * messages but delivered none (Brevo report: requests≈1/day vs 280 sent), so
 * those touches never reached anyone. Without a rewind the leads finish their
 * 3-touch sequence into "No Response" and are never contacted again.
 *
 * What it does (idempotent, non-destructive to history):
 *   1. marks the affected outreach_events rows outcome='undelivered'
 *   2. recomputes each lead's touch counter/status/contacted_at from the
 *      remaining DELIVERED touches (rows not marked undelivered)
 *
 * Usage:  DRY=1 node scripts/rewind-blackout-sends.mjs   # report only
 *         node scripts/rewind-blackout-sends.mjs         # apply
 *         FROM="2026-08-30 12:41+00" SENDER=brevo1 ...   # override window/sender
 */
import pg from "pg";

const FROM = process.env.FROM || "2026-08-30 12:41+00";
const TO = process.env.TO || "2026-09-04 00:00+00"; // Brevo restored the Free plan on Sep 4; sends after that were delivered
const SENDER = process.env.SENDER || "brevo1";
const DRY = process.env.DRY === "1";
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const affected = await c.query(
  `SELECT id, artist_beatport_id, template_id FROM outreach_events
   WHERE channel='email' AND template_id LIKE '%\\_touch\\_%' AND COALESCE(sender,'brevo1')=$1
     AND sent_at >= $2::timestamptz AND sent_at < $3::timestamptz AND COALESCE(outcome,'') <> 'undelivered'`, [SENDER, FROM, TO]);
console.log(`affected sends: ${affected.rowCount} (sender=${SENDER}, ${FROM} → ${TO})`);
if (DRY || affected.rowCount === 0) { await c.end(); process.exit(0); }

await c.query("BEGIN");
try {
  await c.query(`UPDATE outreach_events SET outcome='undelivered' WHERE id = ANY($1::int[])`, [affected.rows.map((r) => r.id)]);

  // SoundCloud: sc:<soundcloud_id>
  const sc = await c.query(`
    WITH ids AS (SELECT DISTINCT substr(artist_beatport_id, 4) sid FROM outreach_events WHERE id = ANY($1::int[]) AND artist_beatport_id LIKE 'sc:%'),
    live AS (SELECT substr(artist_beatport_id,4) sid, COUNT(*) n, MAX(sent_at) last FROM outreach_events
             WHERE artist_beatport_id LIKE 'sc:%' AND template_id LIKE 'sc\\_touch\\_%' AND COALESCE(outcome,'') <> 'undelivered' GROUP BY 1)
    UPDATE sc_artists s SET sc_touch = COALESCE(l.n,0),
      lead_status = CASE WHEN s.lead_status IN ('Contacted','No Response','New') OR s.lead_status IS NULL THEN (CASE WHEN COALESCE(l.n,0)=0 THEN 'New' ELSE 'Contacted' END) ELSE s.lead_status END,
      contacted_at = l.last, updated_at = now()
    FROM ids LEFT JOIN live l ON l.sid = ids.sid WHERE s.soundcloud_id::text = ids.sid`, [affected.rows.map((r) => r.id)]);

  // Spotify: sp:<ig_username>
  const sp = await c.query(`
    WITH ids AS (SELECT DISTINCT substr(artist_beatport_id, 4) sid FROM outreach_events WHERE id = ANY($1::int[]) AND artist_beatport_id LIKE 'sp:%'),
    live AS (SELECT substr(artist_beatport_id,4) sid, COUNT(*) n, MAX(sent_at) last FROM outreach_events
             WHERE artist_beatport_id LIKE 'sp:%' AND template_id LIKE 'sp\\_touch\\_%' AND COALESCE(outcome,'') <> 'undelivered' GROUP BY 1)
    UPDATE spotify_leads s SET sp_touch = COALESCE(l.n,0),
      lead_status = CASE WHEN s.lead_status IN ('Contacted','No Response','New') OR s.lead_status IS NULL THEN (CASE WHEN COALESCE(l.n,0)=0 THEN 'New' ELSE 'Contacted' END) ELSE s.lead_status END,
      contacted_at = l.last, updated_at = now()
    FROM ids LEFT JOIN live l ON l.sid = ids.sid WHERE s.ig_username::text = ids.sid`, [affected.rows.map((r) => r.id)]);

  // Radar: radar:<id>
  const radar = await c.query(`
    WITH ids AS (SELECT DISTINCT substr(artist_beatport_id, 7)::int rid FROM outreach_events WHERE id = ANY($1::int[]) AND artist_beatport_id LIKE 'radar:%'),
    live AS (SELECT substr(artist_beatport_id,7)::int rid, COUNT(*) n, MAX(sent_at) last FROM outreach_events
             WHERE artist_beatport_id LIKE 'radar:%' AND template_id LIKE 'radar\\_touch\\_%' AND COALESCE(outcome,'') <> 'undelivered' GROUP BY 1)
    UPDATE radar_leads r SET touch = COALESCE(l.n,0),
      status = CASE WHEN r.status IN ('contacted','done','new','queued') OR r.status IS NULL THEN (CASE WHEN COALESCE(l.n,0)=0 THEN 'new' ELSE 'contacted' END) ELSE r.status END,
      contacted_at = l.last, updated_at = now()
    FROM ids LEFT JOIN live l ON l.rid = ids.rid WHERE r.id = ids.rid::bigint`, [affected.rows.map((r) => r.id)]);

  // Beatport: lead_profiles.status ∈ New / Attempt 1 / Attempt 2 / No Response
  const bp = await c.query(`
    WITH ids AS (SELECT DISTINCT artist_beatport_id aid FROM outreach_events WHERE id = ANY($1::int[]) AND artist_beatport_id NOT LIKE '%:%'),
    live AS (SELECT artist_beatport_id aid, COUNT(*) n FROM outreach_events
             WHERE template_id LIKE 'email\\_touch\\_%' AND COALESCE(outcome,'') <> 'undelivered' GROUP BY 1)
    UPDATE lead_profiles p SET status = CASE COALESCE(l.n,0) WHEN 0 THEN 'New' WHEN 1 THEN 'Attempt 1' WHEN 2 THEN 'Attempt 2' ELSE 'No Response' END, updated_at = now()
    FROM ids LEFT JOIN live l ON l.aid = ids.aid
    WHERE p.artist_beatport_id = ids.aid AND p.status IN ('New','Attempt 1','Attempt 2','No Response')`, [affected.rows.map((r) => r.id)]);

  await c.query("COMMIT");
  console.log(`rewound: sc=${sc.rowCount} sp=${sp.rowCount} radar=${radar.rowCount} beatport=${bp.rowCount}`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("FAILED, rolled back:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
