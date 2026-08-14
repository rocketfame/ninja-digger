/**
 * Living email segments computed from lead/contact statuses — always current,
 * no materialization needed:
 *  - no_reply: contacted, clean delivery, no reply yet (re-mailing pool)
 *  - warm:     replied / in progress / won (hot pool)
 *  - dead:     bounced emails, opt-outs, blacklist (suppression list)
 */

import { pool } from "@/lib/db";
import { JUNK_NAME_SQL, TIER_SQL } from "@/lib/leadQuality";

export type EmailSegmentType = "no_reply" | "warm" | "dead";

export const SEGMENT_LABELS: Record<EmailSegmentType, string> = {
  no_reply: "Не відповіли (чиста доставка)",
  warm: "Теплі (відповідали)",
  dead: "Помилки та відписки",
};

const NO_REPLY_STATUSES = ["Attempt 1", "Attempt 2", "No Response", "Cold", "Contacted"];
const WARM_STATUSES = ["Responded", "In Progress", "Won"];

export type SegmentRow = {
  artist_beatport_id: string;
  artist_name: string | null;
  email: string;
  lead_status: string;
  chart_segment: string | null;
  tier: string | null;
  first_seen: string | null;
  last_seen: string | null;
};

export async function getSegmentRows(type: EmailSegmentType): Promise<SegmentRow[]> {
  if (type === "dead") {
    const res = await pool.query<SegmentRow>(
      `SELECT ac.artist_beatport_id, am.artist_name, LOWER(TRIM(ac.value)) AS email,
              COALESCE(lp.status, CASE WHEN ac.status = 'bounced' THEN 'bounced' ELSE 'blacklisted' END) AS lead_status,
              ls.segment AS chart_segment, ${TIER_SQL} AS tier, am.first_seen::text, am.last_seen::text
       FROM artist_contacts ac
       LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
       LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
       LEFT JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id
       WHERE ac.type = 'email' AND (
         ac.status IN ('bounced', 'blocked')
         OR LOWER(TRIM(ac.value)) IN (SELECT LOWER(email) FROM email_blacklist)
         OR lp.status IN ('Not Interested', 'Blacklist')
       )
       ORDER BY am.last_seen DESC NULLS LAST`
    );
    return res.rows;
  }
  const statuses = type === "warm" ? WARM_STATUSES : NO_REPLY_STATUSES;
  const res = await pool.query<SegmentRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (ac.artist_beatport_id)
              ac.artist_beatport_id, am.artist_name, LOWER(TRIM(ac.value)) AS email,
              lp.status AS lead_status, ls.segment AS chart_segment,
              ${TIER_SQL} AS tier, am.first_seen::text, am.last_seen::text
       FROM lead_profiles lp
       JOIN artist_contacts ac ON ac.artist_beatport_id = lp.artist_beatport_id
       LEFT JOIN artist_metrics am ON am.artist_beatport_id = lp.artist_beatport_id
       LEFT JOIN lead_scores ls ON ls.artist_beatport_id = lp.artist_beatport_id
       WHERE lp.status = ANY($1::text[])
         AND ac.type = 'email' AND (ac.status IS NULL OR ac.status = 'ok')
         AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         AND NOT ${JUNK_NAME_SQL}
       ORDER BY ac.artist_beatport_id, ac.confidence DESC
     ) t
     ORDER BY t.tier, t.last_seen DESC NULLS LAST`,
    [statuses]
  );
  return res.rows;
}

export type SegmentStats = { type: EmailSegmentType; label: string; count: number; lastUpdated: string | null; gems?: number };

export async function getSegmentStats(): Promise<SegmentStats[]> {
  const q = (sql: string, params: unknown[] = []) =>
    pool.query<{ c: string; u: string | null }>(sql, params)
      .then((r) => ({ count: Number(r.rows[0]?.c ?? 0), lastUpdated: r.rows[0]?.u ?? null }))
      .catch(() => ({ count: 0, lastUpdated: null }));

  const [noReply, warm, dead, gemsRow] = await Promise.all([
    q(
      `SELECT COUNT(DISTINCT lp.artist_beatport_id)::text c, MAX(lp.updated_at)::text u
       FROM lead_profiles lp
       JOIN artist_contacts ac ON ac.artist_beatport_id = lp.artist_beatport_id
       LEFT JOIN artist_metrics am ON am.artist_beatport_id = lp.artist_beatport_id
       WHERE lp.status = ANY($1::text[]) AND ac.type='email' AND (ac.status IS NULL OR ac.status='ok')
         AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         AND NOT ${JUNK_NAME_SQL}`,
      [NO_REPLY_STATUSES]
    ),
    q(
      `SELECT COUNT(DISTINCT lp.artist_beatport_id)::text c, MAX(lp.updated_at)::text u
       FROM lead_profiles lp
       JOIN artist_contacts ac ON ac.artist_beatport_id = lp.artist_beatport_id
       WHERE lp.status = ANY($1::text[]) AND ac.type='email' AND (ac.status IS NULL OR ac.status='ok')`,
      [WARM_STATUSES]
    ),
    q(
      `SELECT COUNT(DISTINCT LOWER(TRIM(ac.value)))::text c, MAX(GREATEST(COALESCE(ac.created_at, 'epoch'), COALESCE(lp.updated_at, 'epoch')))::text u
       FROM artist_contacts ac
       LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
       WHERE ac.type='email' AND (
         ac.status IN ('bounced','blocked')
         OR LOWER(TRIM(ac.value)) IN (SELECT LOWER(email) FROM email_blacklist)
         OR lp.status IN ('Not Interested','Blacklist')
       )`
    ),
    q(
      `SELECT COUNT(DISTINCT lp.artist_beatport_id)::text c, NULL::text u
       FROM lead_profiles lp
       JOIN artist_contacts ac ON ac.artist_beatport_id = lp.artist_beatport_id
       JOIN artist_metrics am ON am.artist_beatport_id = lp.artist_beatport_id
       WHERE lp.status = ANY($1::text[]) AND ac.type='email' AND (ac.status IS NULL OR ac.status='ok')
         AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         AND NOT ${JUNK_NAME_SQL}
         AND ${TIER_SQL} = 'A'`,
      [NO_REPLY_STATUSES]
    ),
  ]);

  return [
    { type: "no_reply", label: SEGMENT_LABELS.no_reply, ...noReply, gems: gemsRow.count },
    { type: "warm", label: SEGMENT_LABELS.warm, ...warm },
    { type: "dead", label: SEGMENT_LABELS.dead, ...dead },
  ];
}
