/**
 * Email hygiene for outreach: pre-send validation (syntax, junk patterns, MX),
 * hard-bounce detection from SMTP errors, and contact invalidation.
 * Invalid emails are marked status='bounced' (NOT deleted) so enrichment
 * upserts can't silently re-add them.
 */

import { promises as dns } from "dns";
import { pool } from "@/lib/db";
import { classifyEmail } from "@/lib/emailJunk";


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

async function domainAcceptsMail(domain: string): Promise<boolean> {
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
