/**
 * Email hygiene for outreach: pre-send validation (syntax, junk patterns, MX),
 * hard-bounce detection from SMTP errors, and contact invalidation.
 * Invalid emails are marked status='bounced' (NOT deleted) so enrichment
 * upserts can't silently re-add them.
 */

import { promises as dns } from "dns";
import { pool } from "@/lib/db";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Role/system addresses that never belong in a lead list. */
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|abuse|spam|webmaster|hostmaster|admin|root|bounce|notifications?|alerts?)$/i;
const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|test\.com|sentry\.(io|com)|cloudflare\.com|wixpress\.com|sentry-next\.wixpress\.com|w3\.org|schema\.org|godaddy\.com|domain\.com)$/i;
/** Regex-extraction artifacts: image/file names picked up as "emails". */
const FILE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|css|js|pdf|mp3|wav)$/i;

const mxCache = new Map<string, boolean>();

async function domainAcceptsMail(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  const cached = mxCache.get(key);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const mx = await dns.resolveMx(key);
    ok = mx.length > 0;
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
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return { ok: false, reason: "invalid syntax" };
  if (FILE_EXT_RE.test(value)) return { ok: false, reason: "file artifact" };
  const [local, domain] = value.split("@");
  if (JUNK_LOCAL.test(local)) return { ok: false, reason: `role address (${local}@)` };
  if (JUNK_DOMAINS.test(domain)) return { ok: false, reason: `junk domain (${domain})` };
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

const HARD_BOUNCE_CODES = new Set([550, 551, 553, 554]);
const HARD_BOUNCE_RE = /(user unknown|does not exist|no such user|mailbox (unavailable|not found)|recipient (rejected|address rejected)|address not found|invalid recipient|account.*(disabled|deleted))/i;

/** True when an SMTP send error means the address itself is dead (vs transient). */
export function isHardBounceError(err: unknown): boolean {
  const e = err as { responseCode?: number; message?: string; response?: string };
  if (e?.responseCode && HARD_BOUNCE_CODES.has(e.responseCode)) return true;
  const text = `${e?.message ?? ""} ${e?.response ?? ""}`;
  return HARD_BOUNCE_RE.test(text);
}
