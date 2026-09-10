/**
 * Email hygiene for outreach: pre-send validation (syntax, junk patterns, MX),
 * hard-bounce detection from SMTP errors, and contact invalidation.
 * Invalid emails are marked status='bounced' (NOT deleted) so enrichment
 * upserts can't silently re-add them.
 */

import { promises as dns } from "dns";
import { pool } from "@/lib/db";
import { classifyEmail, pickBestEmail, isFreemailDomain } from "@/lib/emailJunk";
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
 * Is this address a lead we sell to, or someone who will mark us as spam?
 *
 * Two signals, both from our own data, no list to maintain:
 *  - a non-freemail domain shared by three or more different artists is not an
 *    artist's own address, it is their representation (unitedtalent.com holds
 *    67 of our "leads", caa.com 41, corsonagency.com 36). A booking agency does
 *    not buy a promo pack; it reports the sender.
 *  - an account above the follower ceiling is a star. Every positive reply we
 *    have ever had came from under 20k; Lana Del Rey and Skrillex were in the
 *    queue. Ceiling is app_settings.icp_max_followers, default 50 000.
 *
 * Pure: the caller supplies the two facts. Returns the reason, or null if fine.
 */
export function icpReject(
  email: string, facts: { followers?: number | null; sharedBy: number; maxFollowers: number }
): string | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!isFreemailDomain(domain) && facts.sharedBy >= 3) return `not-ICP: representation domain (${domain} shared by ${facts.sharedBy} artists)`;
  if ((facts.followers ?? 0) > facts.maxFollowers) return `not-ICP: star (${facts.followers} followers > ${facts.maxFollowers})`;
  return null;
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
  text: string | null | undefined, opts: { explicit?: string | null; followers?: number | null } = {}
): Promise<string | null> {
  const email = pickBestEmail(text, opts.explicit);
  if (!email) return null;
  const domain = email.split("@")[1];
  if (!(await domainAcceptsMail(domain))) return null;
  const reason = icpReject(email, { followers: opts.followers, sharedBy: await domainSharedBy(domain), maxFollowers: await icpMaxFollowers() });
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
