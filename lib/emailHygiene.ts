/**
 * Email hygiene for outreach: pre-send validation (syntax, junk patterns, MX),
 * hard-bounce detection from SMTP errors, and contact invalidation.
 * Invalid emails are marked status='bounced' (NOT deleted) so enrichment
 * upserts can't silently re-add them.
 */

import { promises as dns } from "dns";
import { pool } from "@/lib/db";
import { classifyEmail, pickBestEmail, icpReject, isFreemailDomain, FREEMAIL_LIST, NON_ARTIST_NAME_SRC, NON_ARTIST_DESC_SRC } from "@/lib/emailJunk";
import { getSettingOrNull } from "@/lib/settings";


/**
 * Hostile-country email domains — russia (.ru/.su, Mail.ru group, Yandex,
 * Rambler) and Belarus (.by). We never contact these, ever. Political filter.
 * `domain` is the lowercased part after '@'.
 */
const HOSTILE_DOMAIN_RE = /(\.(ru|su|by)$)|((^|\.)yandex\.)/i;
export function isHostileDomain(email: string | null | undefined): boolean {
  const domain = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  return !!domain && HOSTILE_DOMAIN_RE.test(domain);
}

const mxCache = new Map<string, boolean>();

/**
 * The ICP rule over everything already stored, as ONE statement. Runs daily
 * from /api/cron/daily. The gate at write time counts a domain from what it can
 * see; acts of one label spread over days still add up to three only here.
 * Anyone who has ever written back is exempt — a reply is worth more than a
 * rule, and the reply flow must not lose them.
 */
export async function icpSweep(): Promise<{ suppressed: number }> {
  const maxF = await icpMaxFollowers();
  const res = await pool.query(
    `WITH d AS (SELECT split_part(LOWER(email),'@',2) dom, COUNT(DISTINCT soundcloud_id) n FROM sc_artists WHERE email IS NOT NULL GROUP BY 1)
     INSERT INTO email_blacklist (email, reason)
     SELECT DISTINCT LOWER(a.email),
            CASE WHEN a.followers_count > $1 THEN 'not-ICP: star (' || a.followers_count || ' followers > ' || $1 || ')'
                 ELSE 'not-ICP: representation domain (' || d.dom || ' shared by ' || d.n || ' artists)' END
       FROM sc_artists a JOIN d ON d.dom = split_part(LOWER(a.email),'@',2)
      WHERE a.email IS NOT NULL
        AND (a.followers_count > $1 OR (d.n >= 3 AND NOT (d.dom = ANY($2::text[]))))
        AND LOWER(a.email) NOT IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL)
     ON CONFLICT (email) DO NOTHING`,
    [maxF, FREEMAIL_LIST]
  );
  // Non-artist profiles by name or bio, same patterns as the write gate.
  const na = await pool.query(
    `INSERT INTO email_blacklist (email, reason)
     SELECT DISTINCT LOWER(email),
            'not-ICP: not an artist (' || CASE WHEN (COALESCE(full_name,'') || ' ' || COALESCE(username,'')) ~* $1 THEN 'name' ELSE 'bio' END || ')'
       FROM sc_artists
      WHERE email IS NOT NULL
        AND ((COALESCE(full_name,'') || ' ' || COALESCE(username,'')) ~* $1 OR COALESCE(description,'') ~* $2)
        AND LOWER(email) NOT IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL)
     ON CONFLICT (email) DO NOTHING`, [NON_ARTIST_NAME_SRC, NON_ARTIST_DESC_SRC]
  ).catch(() => ({ rowCount: 0 }));
  // YouTube/Radar: stars by the same ceiling (its emails come from channel pages, so the domain rule adds little).
  const rd = await pool.query(
    `INSERT INTO email_blacklist (email, reason)
     SELECT DISTINCT LOWER(email), 'not-ICP: star (' || followers || ' followers > ' || $1 || ')'
       FROM radar_leads WHERE email IS NOT NULL AND followers > $1
        AND LOWER(email) NOT IN (SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL)
     ON CONFLICT (email) DO NOTHING`, [maxF]
  ).catch(() => ({ rowCount: 0 }));
  await pool.query(`UPDATE sc_artists SET email_status='junk', updated_at=now()
     WHERE LOWER(email) IN (SELECT LOWER(email) FROM email_blacklist WHERE reason LIKE 'not-ICP%')
       AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`).catch(() => {});
  return { suppressed: (res.rowCount ?? 0) + (rd.rowCount ?? 0) + (na.rowCount ?? 0) };
}

const domainShareCache = new Map<string, number>();
/** How many distinct SoundCloud artists carry an address on this domain. Cached per process. */
export async function domainSharedBy(domain: string): Promise<number> {
  const d = domain.toLowerCase();
  if (isFreemailDomain(d)) return 0;
  const hit = domainShareCache.get(d);
  if (hit !== undefined) return hit;
  const n = await pool
    .query<{ c: number }>(`SELECT COUNT(DISTINCT soundcloud_id)::int c FROM sc_artists WHERE email IS NOT NULL AND split_part(LOWER(email),'@',2) = $1`, [d])
    .then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  domainShareCache.set(d, n);
  return n;
}

let maxFollowersCache: { v: number; at: number } | null = null;
export async function icpMaxFollowers(): Promise<number> {
  if (maxFollowersCache && Date.now() - maxFollowersCache.at < 300_000) return maxFollowersCache.v;
  const v = parseInt((await getSettingOrNull("icp_max_followers")) ?? "", 10) || 50_000;
  maxFollowersCache = { v, at: Date.now() };
  return v;
}

/**
 * The address a profile may be STORED with, or null: policy, live MX, and the
 * ICP rule above. Both SoundCloud engines and the hygiene backfill go through
 * this, so an address we must never mail never enters the table.
 */
export async function emailForStorage(
  text: string | null | undefined,
  opts: { explicit?: string | null; followers?: number | null; sharedInBatch?: number; name?: string | null; description?: string | null } = {}
): Promise<string | null> {
  const email = pickBestEmail(text, opts.explicit);
  if (!email) return null;
  const domain = email.split("@")[1];
  if (!(await domainAcceptsMail(domain))) return null;
  // A label's four acts arrive in ONE page: none is stored yet, so the stored
  // count says 0 and all four pass. The caller tells us how many other rows
  // in its batch share the domain, and those count too.
  const sharedBy = (await domainSharedBy(domain)) + (opts.sharedInBatch ?? 0);
  const reason = icpReject(email, { followers: opts.followers, sharedBy, maxFollowers: await icpMaxFollowers(), name: opts.name, description: opts.description ?? text });
  return reason ? null : email;
}

export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  const cached = mxCache.get(key);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const mx = await dns.resolveMx(key);
    // RFC 7505 Null MX ("." / empty exchange) = domain explicitly refuses mail
    ok = mx.some((r) => r.exchange && r.exchange !== "." && r.exchange !== "");
  } catch {
    // RFC 5321: fall back to A record when no MX exists
    try {
      const a = await dns.resolve4(key);
      ok = a.length > 0;
    } catch {
      ok = false;
    }
  }
  mxCache.set(key, ok);
  return ok;
}

export type EmailValidation = { ok: true } | { ok: false; reason: string };

/** Full pre-send validation: syntax → junk patterns → MX/A record. */
export async function validateEmailForOutreach(email: string): Promise<EmailValidation> {
  // Static policy (syntax, artifacts, placeholders, platforms, disposable,
  // hostile, role rules) lives in lib/emailJunk — the single source of truth.
  const v = classifyEmail(email);
  if (!v.ok) return { ok: false, reason: v.reason };
  const domain = v.email.split("@")[1];
  if (!(await domainAcceptsMail(domain))) return { ok: false, reason: `no MX/A record (${domain})` };
  return { ok: true };
}

/** Mark a contact email invalid so it is excluded from all future sends. */
export async function invalidateContactEmail(email: string, reason: string): Promise<number> {
  const res = await pool.query(
    `UPDATE artist_contacts SET status = 'bounced'
     WHERE type = 'email' AND LOWER(TRIM(value)) = LOWER(TRIM($1)) AND status != 'bounced'`,
    [email]
  );
  const n = res.rowCount ?? 0;
  if (n > 0) console.log(`[email-hygiene] invalidated ${email}: ${reason}`);
  return n;
}

// Recipient-specific wording or RFC 3463 enhanced codes 5.1.1/5.1.2/5.1.3/5.1.6
// (bad mailbox / bad domain / bad syntax / mailbox moved).
const HARD_BOUNCE_RE = /(user unknown|does not exist|no such user|mailbox (unavailable|not found)|recipient (rejected|address rejected)|address not found|invalid recipient|account.*(disabled|deleted)|\b5\.1\.[1236]\b)/i;

/**
 * True when an SMTP send error means the ADDRESS itself is dead (vs transient).
 * A bare relay-level 550/554 is NOT proof: Brevo answers 550 for daily-quota
 * exhaustion, unauthenticated senders and blocked accounts — treating those as
 * bounces used to mark whole batches of good leads dead.
 */
export function isHardBounceError(err: unknown): boolean {
  const e = err as { responseCode?: number; message?: string; response?: string };
  const text = `${e?.message ?? ""} ${e?.response ?? ""}`;
  return HARD_BOUNCE_RE.test(text);
}
