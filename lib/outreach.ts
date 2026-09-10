/**
 * Phase 7 — Outreach (manual). Get/upsert lead_outreach. No auto-messages.
 */

import { query, pool } from "@/lib/db";

export const OUTREACH_STATUSES = [
  "not_started",
  "contacted",
  "replied",
  "declined",
  "converted",
] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export type OutreachRow = {
  artist_id: number;
  status: string;
  contact_email: string | null;
  contact_other: string | null;
  readiness: boolean;
  updated_at: string;
};

export async function getOutreach(artistId: number): Promise<OutreachRow | null> {
  const rows = await query<OutreachRow>(
    `SELECT artist_id, status, contact_email, contact_other, readiness, updated_at::text AS updated_at
     FROM lead_outreach WHERE artist_id = $1`,
    [artistId]
  );
  return rows[0] ?? null;
}

export async function setOutreach(
  artistId: number,
  data: {
    status?: OutreachStatus | string;
    contact_email?: string | null;
    contact_other?: string | null;
    readiness?: boolean;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO lead_outreach (artist_id, status, contact_email, contact_other, readiness)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (artist_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       contact_email = EXCLUDED.contact_email,
       contact_other = EXCLUDED.contact_other,
       readiness = EXCLUDED.readiness,
       updated_at = NOW()`,
    [
      artistId,
      data.status ?? "not_started",
      data.contact_email ?? null,
      data.contact_other ?? null,
      data.readiness ?? false,
    ]
  );
}

/**
 * A Beatport contact whose artist has not charted in 14 days will not get the
 * chart letter, and the window rule was silently parking 2,451 verified
 * addresses. They are artists; almost every one has Spotify. So the lead
 * changes segment: one row appears in spotify_leads keyed bp:<artist id>, and
 * the Beatport row is retired with status 'moved' so the pipeline never mails
 * it. Moved, not copied — the person has one active row.
 *
 * Only untouched, contactable, mailbox-checked addresses move. Runs daily.
 */
export async function moveStaleBeatportToSpotify(): Promise<{ moved: number }> {
  const { contactableSql } = await import("@/lib/leadPolicy");
  // The identity that moves is the ADDRESS, not the artist: one artist can hold
  // several contacts, and several artists can share one address. Keying the
  // Spotify row by artist dropped the second address of 446 artists while their
  // Beatport rows were already retired — unreachable by either barrel.
  const ins = await pool.query(
    `WITH cand AS (
       SELECT DISTINCT ON (LOWER(TRIM(ac.value)))
              LOWER(TRIM(ac.value)) AS email, am.artist_name AS name
         FROM artist_contacts ac
         JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
         LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
        WHERE ac.type = 'email' AND COALESCE(ac.status,'ok') IN ('ok','moved')
          AND (lp.status IS NULL OR lp.status = 'New')
          AND am.last_seen < current_date - 14
          AND ${contactableSql("TRIM(ac.value)")}
          AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(contact_value) FROM outreach_events WHERE channel = 'email')
        ORDER BY LOWER(TRIM(ac.value)), am.last_seen DESC
     )
     INSERT INTO spotify_leads (ig_username, full_name, email, email_source, source_post, lead_status, created_at, updated_at)
     SELECT 'bp:' || email, name, email, 'beatport', 'beatport-stale', 'New', now(), now() FROM cand
     ON CONFLICT (ig_username) DO NOTHING`
  );
  // Retire EVERY Beatport row carrying an address that now lives in Spotify,
  // whichever artist it hangs on — otherwise the pipeline still sees it.
  await pool.query(
    `UPDATE artist_contacts ac SET status = 'moved'
      WHERE ac.type = 'email' AND COALESCE(ac.status,'ok') = 'ok'
        AND LOWER(TRIM(ac.value)) IN (SELECT LOWER(email) FROM spotify_leads WHERE source_post = 'beatport-stale')`
  );
  return { moved: ins.rowCount ?? 0 };
}
