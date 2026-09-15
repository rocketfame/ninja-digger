/**
 * The warmed base — every lead we ever touched, with what they did, kept in
 * OUR database for good (user, 15.09: "щоб я міг швидко далі юзати цю
 * відфільтровану базу"). One row per address, both channels merged:
 *
 *   segment  hot = clicked, or wrote back to Max and was answered (a reply
 *            is warmer than a click) · warm = opened · cold = no reaction ·
 *            converted = bought after the touch · customer = shop customer
 *            before us · blacklist = bounce / complaint / unsubscribe, or
 *            banned / ignored in the bot (user, 15.09)
 *   source   where the lead came from: reex:<advertiser> | graph | upload |
 *            instagram:<post> | youtube:<url>
 *
 * The passport (name, followers, country, tier, profile) comes from the
 * lead tables; the reactions from email_events and tg_notifications.
 */
import { pool } from "@/lib/db";

export type SegmentRow = {
  email: string; platform: string; segment: string; channel: string; replied_open: boolean;
  name: string | null; followers: number | null; country: string | null; tier: string | null;
  source: string | null; profile_url: string | null;
  first_touch: string; last_event: string | null; opens: number; clicks: number; orders: number; revenue: number;
};

export type SegmentFilter = { segment?: string; platform?: string; source?: string; tier?: string; days?: number; limit?: number; offset?: number };

/** One relation of every touched lead with passport, both channels. */
const TOUCHED_SQL = `
  WITH t AS (
    SELECT LOWER(a.email) email, 'soundcloud' platform, 'personal' channel, a.contacted_at t,
           COALESCE(a.full_name, a.username) name, a.followers_count::int followers, a.country_code::text country, a.tier::text tier,
           CASE WHEN a.source_seed LIKE 'graph:%' THEN 'graph' WHEN a.source_seed LIKE 'upload:%' THEN 'upload' ELSE 'reex:' || COALESCE(a.source_seed,'?') END source,
           a.permalink_url::text profile_url, a.lead_status = 'Responded' replied
      FROM sc_artists a WHERE a.contacted_at IS NOT NULL AND a.email IS NOT NULL
    UNION ALL
    SELECT LOWER(s.email), 'spotify', 'personal', s.contacted_at,
           COALESCE(s.full_name, s.ig_username), s.followers::int, NULL::text, NULL::text,
           CASE WHEN s.source_post = 'beatport-stale' THEN 'beatport:stale' ELSE 'instagram:' || COALESCE(s.source_post,'?') END, COALESCE(s.spotify_url, 'https://instagram.com/' || s.ig_username)::text, s.lead_status = 'Responded'
      FROM spotify_leads s WHERE s.contacted_at IS NOT NULL AND s.email IS NOT NULL
    UNION ALL
    SELECT LOWER(r.email), 'youtube', 'personal', r.contacted_at,
           r.name, r.followers::int, NULL::text, NULL::text, 'youtube:' || COALESCE(r.source,'?'), r.source_url::text, false
      FROM radar_leads r WHERE r.contacted_at IS NOT NULL AND r.email IS NOT NULL
    UNION ALL
    SELECT le.email, le.platform, 'mass', le.exported_at,
           COALESCE(a.full_name, a.username, s.full_name, s.ig_username, r.name), COALESCE(a.followers_count, s.followers, r.followers)::int, a.country_code::text, a.tier::text,
           CASE WHEN a.email IS NOT NULL THEN (CASE WHEN a.source_seed LIKE 'graph:%' THEN 'graph' WHEN a.source_seed LIKE 'upload:%' THEN 'upload' ELSE 'reex:' || COALESCE(a.source_seed,'?') END)
                WHEN s.email IS NOT NULL THEN (CASE WHEN s.source_post = 'beatport-stale' THEN 'beatport:stale' ELSE 'instagram:' || COALESCE(s.source_post,'?') END)
                WHEN r.email IS NOT NULL THEN 'youtube:' || COALESCE(r.source,'?') ELSE NULL END,
           COALESCE(a.permalink_url, s.spotify_url, r.source_url)::text, false
      FROM lead_exports le
      LEFT JOIN sc_artists a ON LOWER(a.email) = le.email
      LEFT JOIN spotify_leads s ON LOWER(s.email) = le.email
      LEFT JOIN radar_leads r ON LOWER(r.email) = le.email
     WHERE le.batch LIKE 'Leads: %' OR le.batch LIKE 'd3-%' OR le.batch LIKE 'warm-%'
  ),
  lead AS (
    SELECT email, (array_agg(platform ORDER BY t))[1] platform, (array_agg(channel ORDER BY t))[1] channel, MIN(t) first_touch,
           (array_agg(name ORDER BY t))[1] name, MAX(followers) followers, (array_agg(country ORDER BY t))[1] country, (array_agg(tier ORDER BY t))[1] tier,
           (array_agg(source ORDER BY t))[1] source, (array_agg(profile_url ORDER BY t))[1] profile_url, bool_or(replied) replied
      FROM t GROUP BY email
  ),
  ev AS (
    SELECT l.email,
           COUNT(*) FILTER (WHERE e.event IN ('opened','uniqueopened'))::int opens,
           COUNT(*) FILTER (WHERE e.event LIKE 'click%')::int clicks,
           bool_or(e.event = 'delivered') delivered,
           bool_or(e.event IN ('hard_bounce','hardbounces','blocked','invalid','unsubscribed','spam')) negative,
           MAX(e.ts) last_event
      FROM lead l LEFT JOIN email_events e ON e.email = l.email AND e.ts >= l.first_touch GROUP BY 1
  ),
  ord AS (
    SELECT l.email, COUNT(o.order_id)::int orders, COALESCE(SUM(o.total),0)::float revenue
      FROM lead l JOIN shop_orders o ON o.email = l.email AND o.created_at >= l.first_touch GROUP BY 1
  )
  SELECT l.*, l.first_touch::text first_touch_s, ev.last_event::text last_event, COALESCE(ev.opens,0) opens, COALESCE(ev.clicks,0) clicks,
         (l.email IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL AND ignored_at IS NULL)) replied_open,
         COALESCE(ord.orders,0) orders, COALESCE(ord.revenue,0) revenue,
         CASE WHEN ev.negative OR l.email IN (SELECT LOWER(email) FROM email_blacklist) THEN 'blacklist'
              WHEN ord.orders > 0 THEN 'converted'
              WHEN l.email IN (SELECT email FROM shop_customers) THEN 'customer'
              -- replied and we answered (or still open) → hot; replied and we ignored every message → cold
              WHEN l.email IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL GROUP BY 1 HAVING bool_or(ignored_at IS NULL)) THEN 'hot'
              WHEN COALESCE(ev.clicks,0) > 0 THEN 'hot'
              WHEN COALESCE(ev.opens,0) > 0 THEN 'warm'
              ELSE 'cold' END segment
    FROM lead l LEFT JOIN ev ON ev.email = l.email LEFT JOIN ord ON ord.email = l.email`;

/** Working segments (people we may still talk to) and service buckets (we may not). */
export const SEGMENTS = ["hot", "warm", "cold"] as const;
export const SERVICE = ["converted", "customer", "blacklist"] as const;

export async function segmentCounts(): Promise<{ segment: string; platform: string; c: number }[]> {
  const rows = await pool.query<{ segment: string; platform: string; c: string }>(`SELECT segment, platform, COUNT(*) c FROM (${TOUCHED_SQL}) x GROUP BY 1,2`).then((x) => x.rows).catch(() => []);
  return rows.map((x) => ({ segment: x.segment, platform: x.platform, c: Number(x.c) }));
}

export async function segmentRows(f: SegmentFilter): Promise<SegmentRow[]> {
  const conds: string[] = []; const params: unknown[] = [];
  if (f.segment) { params.push(f.segment); conds.push(`segment = $${params.length}`); }
  if (f.platform) { params.push(f.platform); conds.push(`platform = $${params.length}`); }
  if (f.source) { params.push(f.source + "%"); conds.push(`source LIKE $${params.length}`); }
  if (f.tier) { params.push(f.tier); conds.push(`tier = $${params.length}`); }
  if (f.days) { params.push(String(f.days)); conds.push(`first_touch > now() - ($${params.length} || ' days')::interval`); }
  params.push(f.limit ?? 200); const lim = params.length;
  params.push(f.offset ?? 0); const off = params.length;
  const rows = await pool.query<SegmentRow & { first_touch_s: string }>(
    `SELECT email, platform, segment, channel, replied_open, name, followers, country, tier, source, profile_url, first_touch_s AS first_touch, last_event, opens, clicks, orders, revenue
       FROM (${TOUCHED_SQL}) x ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
      ORDER BY CASE segment WHEN 'converted' THEN 0 WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 WHEN 'cold' THEN 3 WHEN 'customer' THEN 4 ELSE 5 END, last_event DESC NULLS LAST
      LIMIT $${lim} OFFSET $${off}`, params
  ).then((r) => r.rows).catch(() => []);
  return rows;
}
