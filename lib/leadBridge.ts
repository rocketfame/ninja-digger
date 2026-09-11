/**
 * The hand-over of leads to the mass channel and the outcomes that come back.
 * One implementation for the HTTP bridge (/api/internal/leads/export, which
 * eSputnik's people call) and for the cron that pushes to eSputnik directly —
 * two callers, one definition of "which leads may go" and "what an outcome
 * does to a lead".
 */
import { pool } from "@/lib/db";
import { OPENED_SQL, REPLIED_SQL, SUPPRESSED_SQL, leadSourcesSql, massEligibleSql, type Platform } from "@/lib/leadPolicy";
import { quarantineEmail } from "@/lib/emailScrub";

export type MassLead = {
  email: string; platform: string; name: string | null; followers: number | null;
  country: string | null; profile_url: string | null; found_at: string | null; verdict: string | null;
};

export type MassSelect = {
  platforms: Platform[];
  limit: number;
  verifiedOnly?: boolean;      // default true: SMTP-verified live mailboxes only
  engagement?: "any" | "engaged" | "replied";
  minFollowers?: number;
  countries?: string[];
  cursor?: string;             // keyset: emails greater than this
};

function whereSql(o: MassSelect, firstParam: number): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let i = firstParam;
  const parts = [
    `s.email NOT IN (${SUPPRESSED_SQL})`,
    massEligibleSql("s.email", "s.cold_at"),
    o.verifiedOnly === false ? `COALESCE(v.verdict,'unknown') <> 'invalid'` : `v.verdict = 'valid'`,
  ];
  if (o.engagement === "engaged") parts.push(`s.email IN (${OPENED_SQL})`);
  if (o.engagement === "replied") parts.push(`s.email IN (${REPLIED_SQL})`);
  if ((o.minFollowers ?? 0) > 0) { parts.push(`COALESCE(s.followers, 0) >= $${i++}`); params.push(o.minFollowers); }
  if (o.countries && o.countries.length > 0) { parts.push(`UPPER(COALESCE(s.country, '')) = ANY($${i++}::text[])`); params.push(o.countries); }
  if (o.cursor) { parts.push(`s.email > $${i++}`); params.push(o.cursor); }
  return { sql: parts.join("\n          AND "), params };
}

/** One page of leads the mass channel may take right now. */
export async function selectMassLeads(o: MassSelect): Promise<MassLead[]> {
  const w = whereSql(o, 2);
  const r = await pool.query<MassLead>(
    `WITH src AS (${leadSourcesSql(o.platforms)})
     SELECT DISTINCT ON (s.email) s.email, s.platform, s.name, s.followers, s.country, s.profile_url, s.found_at, v.verdict
       FROM src s LEFT JOIN email_verification v ON v.email = s.email
      WHERE ${w.sql}
      ORDER BY s.email, s.found_at DESC NULLS LAST
      LIMIT $1`,
    [o.limit, ...w.params]
  );
  return r.rows;
}

/** How many match the same filters (ignores limit/cursor). */
export async function countMassLeads(o: MassSelect): Promise<number> {
  const w = whereSql({ ...o, cursor: undefined }, 1);
  return pool
    .query<{ c: string }>(
      `WITH src AS (${leadSourcesSql(o.platforms)})
       SELECT COUNT(DISTINCT s.email) c FROM src s LEFT JOIN email_verification v ON v.email = s.email WHERE ${w.sql}`,
      w.params
    )
    .then((r) => Number(r.rows[0]?.c ?? 0));
}

/**
 * Write the ledger: these addresses now belong to the mass channel under
 * `batch`. A re-export after a full cycle refreshes the row rather than being
 * refused — the 30-day rule lives in massEligibleSql, not here. Also logs a
 * 'sent' event per address (src = mass system) so the fatigue rule can count.
 */
export async function recordHandover(rows: { email: string; platform: string }[], batch: string, src: "esputnik" | "listmonk" = "esputnik"): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO lead_exports (email, platform, batch)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
     ON CONFLICT (email) DO UPDATE SET platform = EXCLUDED.platform, batch = EXCLUDED.batch,
       exported_at = now(), outcome = NULL, outcome_at = NULL`,
    [rows.map((r) => r.email), rows.map((r) => r.platform), rows.map(() => batch)]
  );
  await pool.query(
    `INSERT INTO email_events (email, event, ts, meta)
     SELECT e, 'sent', now(), $2::jsonb FROM UNNEST($1::text[]) AS e
     ON CONFLICT (email, event, ts) DO NOTHING`,
    [rows.map((r) => r.email), JSON.stringify({ src, campaign: batch })]
  ).catch(() => {});
}

export type Outcome = { email: string; outcome: string; at?: Date; campaign?: string; src: "esputnik" | "listmonk" };

/**
 * One outcome from the mass channel: logged on the person's timeline, written
 * to the ledger, and — for anything negative — suppressed for every channel
 * we have, immediately. 'cold' hands the lead back.
 */
export async function recordOutcome(o: Outcome): Promise<{ logged: boolean; recorded: boolean; suppressed: boolean; released: boolean }> {
  const e = o.email.trim().toLowerCase();
  const out = o.outcome.trim().toLowerCase();
  const ts = o.at ?? new Date();
  const logged = await pool
    .query(`INSERT INTO email_events (email, event, ts, meta) VALUES ($1,$2,$3,$4) ON CONFLICT (email, event, ts) DO NOTHING`,
      [e, out, ts, JSON.stringify({ src: o.src, ...(o.campaign ? { campaign: o.campaign } : {}) })])
    .then((r) => (r.rowCount ?? 0) > 0).catch(() => false);
  const recorded = await pool
    .query(`UPDATE lead_exports SET outcome = $2, outcome_at = now() WHERE email = $1`, [e, out])
    .then((r) => (r.rowCount ?? 0) > 0).catch(() => false);
  let suppressed = false;
  if (/bounce|complain|spam|unsub|invalid/.test(out)) { await quarantineEmail(e, `${o.src}: ${out}`); suppressed = true; }
  return { logged, recorded, suppressed, released: out === "cold" };
}
