/**
 * The mass channel measured — one row per day and platform, from our own
 * tables (ledger, hourly-pulled eSputnik events, mirrored Shopify orders).
 *
 * "Ordered" is attributed three ways, any one is enough:
 *   code   – the order used a MAX* code
 *   email  – the buyer's address is in the lead ledger (bought without a code)
 *   utm    – the landing page carried utm_source=offers
 * An order counts for the day/platform of the lead's push; orders whose
 * buyer we never pushed but who used a MAX code or came via utm=offers land
 * in a separate "unattributed" line so nothing is lost.
 */
import { pool } from "@/lib/db";
import { MASS_CODES } from "@/lib/shopOrders";

export type MassRow = {
  day: string; platform: string;
  planned: number; budget: number; pushed: number;
  delivered: number; opened: number; clicked: number; unsub: number; bounced: number;
  ordered: number; revenue: number; retired: number; live: number;
};

export type ChannelMoney = { channel: string; buyers: number; orders: number; revenue: number; withCode: number };
export type BuyerRow = { email: string; channel: string; first_touch: string; orders: number; revenue: number; codes: string[]; last_order: string };

export type PersonalRow = { day: string; platform: string; sent: number; delivered: number; opened: number; replied: number; ordered: number; revenue: number };

export type MassSummary = {
  personal: { rows: PersonalRow[]; totals: Omit<PersonalRow, "day" | "platform"> };
  money: ChannelMoney[];
  buyers: BuyerRow[];
  rows: MassRow[];
  totals: Omit<MassRow, "day" | "platform">;
  unattributed: { orders: number; revenue: number; byCode: { code: string; orders: number }[] };
  base: { size: number | null; at: string | null; planLimit: number; reserve: number; live: number; window: number };
};

export async function massStats(days = 30): Promise<MassSummary> {
  const rows = await pool.query<MassRow>(
    `WITH led AS (
       SELECT le.email, le.platform, le.exported_at::date AS day, le.exported_at, le.outcome
         FROM lead_exports le WHERE (le.batch LIKE 'Leads: %' OR le.batch LIKE 'd3-%' OR le.batch LIKE 'warm-%') AND le.exported_at > now() - ($1 || ' days')::interval
     ),
     ev AS (
       SELECT l.email, l.platform, l.day,
              bool_or(e.event = 'delivered') delivered,
              bool_or(e.event = 'opened') opened,
              bool_or(e.event = 'click') clicked,
              bool_or(e.event = 'unsubscribed') unsub,
              bool_or(e.event = 'hard_bounce') bounced
         FROM led l LEFT JOIN email_events e ON e.email = l.email AND e.ts >= l.exported_at AND e.ts < l.exported_at + interval '30 days'
        GROUP BY 1,2,3
     ),
     ord AS (
       SELECT l.email, l.platform, l.day, COUNT(DISTINCT o.order_id) n, COALESCE(SUM(o.total),0) rev
         FROM led l JOIN shop_orders o ON o.email = l.email AND o.created_at >= l.exported_at
        GROUP BY 1,2,3
     ),
     push AS (SELECT day, platform, planned, budget, pushed FROM mass_pushes WHERE day > now()::date - $1::int)
     SELECT d.day::text AS day, d.platform,
            COALESCE(p.planned,0)::int planned, COALESCE(p.budget,0)::int budget,
            COUNT(DISTINCT d.email)::int pushed,
            COUNT(DISTINCT d.email) FILTER (WHERE ev.delivered)::int delivered,
            COUNT(DISTINCT d.email) FILTER (WHERE ev.opened)::int opened,
            COUNT(DISTINCT d.email) FILTER (WHERE ev.clicked)::int clicked,
            COUNT(DISTINCT d.email) FILTER (WHERE ev.unsub)::int unsub,
            COUNT(DISTINCT d.email) FILTER (WHERE ev.bounced)::int bounced,
            COALESCE(SUM(ord.n),0)::int ordered, COALESCE(SUM(ord.rev),0)::float revenue,
            COUNT(DISTINCT d.email) FILTER (WHERE d.outcome = 'retired')::int retired,
            COUNT(DISTINCT d.email) FILTER (WHERE COALESCE(d.outcome,'') NOT IN ('retired','converted','bounced','complained','unsubscribed'))::int live
       FROM led d
       LEFT JOIN ev ON ev.email = d.email AND ev.platform = d.platform AND ev.day = d.day
       LEFT JOIN ord ON ord.email = d.email AND ord.platform = d.platform AND ord.day = d.day
       LEFT JOIN push p ON p.day = d.day AND p.platform = d.platform
      GROUP BY d.day, d.platform, p.planned, p.budget
      ORDER BY d.day DESC, d.platform`,
    [String(days)]
  ).then((r) => r.rows).catch(() => [] as MassRow[]);

  const totals = rows.reduce((t, r) => ({
    planned: t.planned + r.planned, budget: t.budget + r.budget, pushed: t.pushed + r.pushed,
    delivered: t.delivered + r.delivered, opened: t.opened + r.opened, clicked: t.clicked + r.clicked,
    unsub: t.unsub + r.unsub, bounced: t.bounced + r.bounced, ordered: t.ordered + r.ordered, revenue: t.revenue + r.revenue,
    retired: t.retired + r.retired, live: t.live + r.live,
  }), { planned: 0, budget: 0, pushed: 0, delivered: 0, opened: 0, clicked: 0, unsub: 0, bounced: 0, ordered: 0, revenue: 0, retired: 0, live: 0 });

  // Orders that carry our fingerprints but whose buyer is not in the ledger.
  const un = await pool.query<{ orders: string; revenue: string }>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM shop_orders
      WHERE created_at > now() - ($1 || ' days')::interval
        AND (codes && $2::text[] OR utm_source = 'offers')
        AND (email IS NULL OR email NOT IN (SELECT email FROM lead_exports))`,
    [String(days), MASS_CODES]
  ).then((r) => r.rows[0]).catch(() => ({ orders: "0", revenue: "0" }));
  const byCode = await pool.query<{ code: string; orders: string }>(
    `SELECT c AS code, COUNT(*) AS orders FROM shop_orders, UNNEST(codes) AS c
      WHERE created_at > now() - ($1 || ' days')::interval AND c = ANY($2::text[]) GROUP BY 1 ORDER BY 2 DESC`,
    [String(days), MASS_CODES]
  ).then((r) => r.rows.map((x) => ({ code: x.code, orders: Number(x.orders) }))).catch(() => []);

  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key IN ('esputnik_base_size','esputnik_plan_limit','esputnik_reserve','esputnik_window')`)
    .then((r) => Object.fromEntries(r.rows.map((x) => [x.key, x.value]))).catch(() => ({} as Record<string, string>));
  const m = (s.esputnik_base_size ?? "").match(/^(\d+)@(\d+)$/);
  const liveAll = await pool.query<{ c: string }>(`SELECT COUNT(*) c FROM lead_exports WHERE batch LIKE 'Leads: %' AND COALESCE(outcome,'') NOT IN ('retired','converted','bounced','complained','unsubscribed')`).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);

  // THE HEADLINE — money from leads, per channel. A lead is any address we
  // ever touched (personal cold email or mass push); an order counts when it
  // came AFTER the first touch, code or no code. Repeat orders count: that is
  // the lead's lifetime value.
  const TOUCHED = `
    SELECT LOWER(email) email, 'personal' ch, contacted_at t FROM sc_artists WHERE contacted_at IS NOT NULL AND email IS NOT NULL
    UNION ALL SELECT LOWER(email), 'personal', contacted_at FROM spotify_leads WHERE contacted_at IS NOT NULL AND email IS NOT NULL
    UNION ALL SELECT LOWER(email), 'personal', contacted_at FROM radar_leads WHERE contacted_at IS NOT NULL AND email IS NOT NULL
    UNION ALL SELECT e.email, 'personal', MIN(e.ts) FROM email_events e WHERE e.event='sent' AND COALESCE(e.meta->>'src','') NOT IN ('esputnik','listmonk') GROUP BY 1
    UNION ALL SELECT email, 'mass', exported_at FROM lead_exports WHERE batch LIKE 'Leads: %' OR batch LIKE 'd3-%' OR batch LIKE 'warm-%'`;
  const money = await pool.query<{ channel: string; buyers: string; orders: string; revenue: string; with_code: string }>(
    `WITH touched AS (${TOUCHED}),
     ft AS (SELECT email, ch AS channel, MIN(t) first_t FROM touched GROUP BY 1,2)
     SELECT ft.channel, COUNT(DISTINCT o.email) buyers, COUNT(*) orders, COALESCE(SUM(o.total),0) revenue,
            COUNT(*) FILTER (WHERE o.codes && $2::text[]) with_code
       FROM shop_orders o JOIN ft ON ft.email = o.email AND o.created_at >= ft.first_t
      WHERE o.created_at > now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [String(days), MASS_CODES]
  ).then((r) => r.rows.map((x) => ({ channel: x.channel, buyers: Number(x.buyers), orders: Number(x.orders), revenue: Number(x.revenue), withCode: Number(x.with_code) }))).catch(() => [] as ChannelMoney[]);
  const buyers = await pool.query<BuyerRow>(
    `WITH touched AS (${TOUCHED}),
     ft AS (SELECT email, MIN(t) first_t, (array_agg(ch ORDER BY t))[1] channel FROM touched GROUP BY 1)
     SELECT o.email, ft.channel, ft.first_t::date::text first_touch, COUNT(*)::int orders, COALESCE(SUM(o.total),0)::float revenue,
            ARRAY(SELECT DISTINCT c FROM shop_orders o2, UNNEST(o2.codes) c WHERE o2.email = o.email AND o2.created_at >= ft.first_t) codes,
            MAX(o.created_at)::date::text last_order
       FROM shop_orders o JOIN ft ON ft.email = o.email AND o.created_at >= ft.first_t
      WHERE o.created_at > now() - ($1 || ' days')::interval
      GROUP BY o.email, ft.channel, ft.first_t ORDER BY MAX(o.created_at) DESC LIMIT 50`,
    [String(days)]
  ).then((r) => r.rows).catch(() => [] as BuyerRow[]);

  // PERSONAL CHANNEL — Max's one cold email per lead (Brevo). Per day and
  // platform: sent, delivered, opened (Brevo events on the lead row), replied
  // (any reply lands in tg_notifications), ordered (shop order after the send).
  const personalRows = await pool.query<PersonalRow>(
    `WITH sent AS (
       SELECT LOWER(email) email, 'soundcloud' platform, contacted_at t, delivered_at, first_open_at FROM sc_artists WHERE contacted_at > now() - ($1 || ' days')::interval AND email IS NOT NULL
       UNION ALL SELECT LOWER(email), 'spotify', contacted_at, delivered_at, first_open_at FROM spotify_leads WHERE contacted_at > now() - ($1 || ' days')::interval AND email IS NOT NULL
       UNION ALL SELECT LOWER(r.email), 'youtube', r.contacted_at,
              (SELECT MIN(e.ts) FROM email_events e WHERE e.email = LOWER(r.email) AND e.event = 'delivered' AND e.ts >= r.contacted_at AND COALESCE(e.meta->>'src','') NOT IN ('esputnik','listmonk')),
              (SELECT MIN(e.ts) FROM email_events e WHERE e.email = LOWER(r.email) AND e.event IN ('opened','uniqueopened','click') AND e.ts >= r.contacted_at AND COALESCE(e.meta->>'src','') NOT IN ('esputnik','listmonk'))
         FROM radar_leads r WHERE r.contacted_at > now() - ($1 || ' days')::interval AND r.email IS NOT NULL
     ),
     ord AS (
       SELECT s.email, s.platform, s.t::date AS day, COUNT(o.order_id) n, COALESCE(SUM(o.total),0) rev
         FROM sent s JOIN shop_orders o ON o.email = s.email AND o.created_at >= s.t GROUP BY 1,2,3
     )
     SELECT s.t::date::text AS day, s.platform,
            COUNT(*)::int sent, COUNT(s.delivered_at)::int delivered, COUNT(s.first_open_at)::int opened,
            COUNT(*) FILTER (WHERE s.email IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL))::int replied,
            COALESCE(SUM(ord.n),0)::int ordered, COALESCE(SUM(ord.rev),0)::float revenue
       FROM sent s LEFT JOIN ord ON ord.email = s.email AND ord.platform = s.platform AND ord.day = s.t::date
      GROUP BY 1,2 ORDER BY 1 DESC, 2`,
    [String(days)]
  ).then((r) => r.rows).catch(() => [] as PersonalRow[]);
  const personalTotals = personalRows.reduce((t, r) => ({
    sent: t.sent + r.sent, delivered: t.delivered + r.delivered, opened: t.opened + r.opened, replied: t.replied + r.replied, ordered: t.ordered + r.ordered, revenue: t.revenue + r.revenue,
  }), { sent: 0, delivered: 0, opened: 0, replied: 0, ordered: 0, revenue: 0 });

  return {
    personal: { rows: personalRows, totals: personalTotals },
    money, buyers, rows, totals,
    unattributed: { orders: Number(un.orders), revenue: Number(un.revenue), byCode },
    base: {
      size: m ? Number(m[1]) : null, at: m ? new Date(Number(m[2])).toISOString() : null,
      planLimit: Number(s.esputnik_plan_limit ?? 25000), reserve: Number(s.esputnik_reserve ?? 1500), live: liveAll, window: Number(s.esputnik_window ?? 4500),
    },
  };
}
