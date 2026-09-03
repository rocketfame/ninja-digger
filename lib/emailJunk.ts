/**
 * Single source of truth for "is this email worth contacting?".
 *
 * Every extractor (SoundCloud, Beatport enrich, YouTube/Reddit radar, Spotify
 * crawl) and every sender barrel must go through classifyEmail(); nothing else
 * may keep its own junk regex. Rules, in order:
 *   1. syntax / length / regex-artifact (file names, "@2x")
 *   2. tracking & infrastructure hosts (sentry, wixpress, cloudfront, googleapis…)
 *   3. placeholders (user@domain.com, youremail@example.com, ejemplo, test@test)
 *   4. platform mailboxes that are never a person's inbox (bandcamp, facebook…)
 *   5. disposable / temp-mail domains (vendored blocklist, ~8.7k domains)
 *   6a. relay/alias/burner services (Apple Hide My Email, duck.com, SimpleLogin…)
 *   6b. hostile-country domains (.ru/.su/.by, yandex, mail.ru) — political filter
 *   7. HARD role mailboxes (RFC 2142 + common ops/legal/sales) — never
 *   8. SOFT role mailboxes (info@, booking@, mgmt@…) — allowed ONLY on a domain
 *      that looks like the artist's own (not freemail / platform / generic)
 * Typos in freemail domains (gmial.com) are corrected, not rejected.
 */
import disposableList from "./data/disposable-domains.json";

export type EmailVerdict = { ok: true; email: string; soft: boolean } | { ok: false; email: string; reason: string };

const DISPOSABLE = new Set<string>(disposableList as string[]);

const EMAIL_STRICT = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;
export const EMAIL_SCAN_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g;

const FILE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|pdf|mp3|wav|zip|html?)$/i;
const TRACKING_RE = /(^|\.)(sentry|sentry-next|wixpress|cloudfront|amazonaws|googleapis|gstatic|fontawesome|w3|schema|cloudflare|akamai|fastly|hubspot|mailchimp|sendgrid|mandrillapp|sparkpostmail|localhost|invalid|test|example|local)(\.|$)|\bingest\./i;
const PLACEHOLDER_DOMAIN_RE = /^(example|ejemplo|prueba|domain|yourdomain|yoursite|mysite|test|placeholder|company|site|website|host|server|abc|xyz|foo|bar)\.(com|org|net|io|co)$/i;
const PLACEHOLDER_LOCAL_RE = /^(example|sample|test|testing|your|yourname|youremail|yourmail|your\.?email|name|user|username|someone|nobody|firstname|lastname|first\.last|john\.?doe|jane\.?doe|tuemail|tucorreo|tu\.?nombre|abc|xyz|foo|bar|asdf|qwerty|null|undefined)$/i;
const PLACEHOLDER_ANY_RE = /(ejemplo|youremail|yourname|tuemail|tucorreo|example\.com)/i;

// Platforms whose @domain mailboxes are the platform's, not the artist's.
const PLATFORM_DOMAINS = new Set([
  "bandcamp.com", "soundcloud.com", "spotify.com", "tiktok.com", "youtube.com", "google.com", "facebook.com", "fb.com",
  "instagram.com", "twitter.com", "x.com", "threads.net", "apple.com", "distrokid.com", "tunecore.com", "cdbaby.com",
  "patreon.com", "linktr.ee", "linktree.com", "beacons.ai", "beacons.page", "wix.com", "squarespace.com", "shopify.com",
  "godaddy.com", "reddit.com", "redditmail.com", "ra.co", "discord.com", "discordapp.com", "twitch.tv", "spacehey.com",
  "latofonts.com", "hypeddit.com", "toneden.io", "ffm.to", "lnk.to", "linkfire.com", "songkick.com", "bandsintown.com",
  "amazon.com", "microsoft.com", "adobe.com", "wordpress.com", "wordpress.org", "vimeo.com", "medium.com", "substack.com",
]);

// Freemail providers: soft roles like info@gmail.com are nonsense, but a
// person's own gmail is perfectly fine.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es", "yahoo.it", "ymail.com",
  "outlook.com", "outlook.de", "outlook.fr", "outlook.es", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de",
  "hotmail.es", "hotmail.it", "live.com", "live.co.uk", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.de", "gmx.net", "gmx.at", "web.de", "t-online.de", "mail.com",
  "zoho.com", "yandex.com", "fastmail.com", "hey.com", "tutanota.com", "tuta.io", "libero.it", "orange.fr", "free.fr",
  "laposte.net", "sfr.fr", "wanadoo.fr", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "ukr.net", "i.ua", "bk.ru",
]);

const TYPO_DOMAINS: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmali.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmai.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com",
  "iclod.com": "icloud.com", "icloud.con": "icloud.com",
};

// Relay / alias / burner addresses: the person hides their real inbox behind a
// forwarding service (Apple Hide My Email, DuckDuckGo, Firefox Relay, SimpleLogin,
// addy.io, Proton Pass aliases). Low intent, often one-shot — never worth a send.
// NOTE: Proton Mail / Tutanota themselves are ordinary privacy providers and stay allowed.
const RELAY_RE = /(^|\.)(privaterelay\.appleid\.com|duck\.com|mozmail\.com|relay\.firefox\.com|simplelogin\.(com|co|io|fr)|aleeas\.com|slmail\.me|silomails\.com|anonaddy\.(com|me)|addy\.io|addymail\.com|passmail\.net|passinbox\.com|passfwd\.com|passmail\.com|hidemyemail\.\w+|33mail\.com|dropmail\.me|spamgourmet\.com|trashmail\.\w+)$/i;

const HOSTILE_RE = /(\.(ru|su|by)$)|((^|\.)(yandex|mail\.ru|rambler|bk\.ru|list\.ru|inbox\.ru)(\.|$))/i;

// RFC 2142 + ops/legal/commerce roles: never a person, never a lead.
const HARD_ROLE_RE = /^(no-?reply|do-?not-?reply|donotreply|noreply\w*|mailer-?daemon|postmaster|hostmaster|webmaster|abuse|spam|bounces?|root|admin|administrator|sysadmin|noc|security|privacy|legal|dmca|copyright|compliance|support|helpdesk|help-?desk|help|billing|invoices?|payments?|accounts?|accounting|finance|sales|orders?|shop|store|newsletter|subscribe|unsubscribe|notifications?|alerts?|feedback|marketing|jobs|careers|hr|recruit(ing|ment)?|guidelines|it|tech|devops|dev|api|system|daemon|test|testing)$/i;

// Roles an independent artist genuinely uses on their own domain.
const SOFT_ROLE_RE = /^(info|contact|contacts|hello|hi|hey|team|mail|office|booking|bookings|book|mgmt|management|manager|promo|promos|promotion|demo|demos|submission|submissions|press|media|studio|label|records|business|biz|collab|collabs|inquiries|inquiry|enquiries|enquiry|general)$/i;

const HTML_ESCAPES_RE = /&[a-z#0-9]+;|\\u00[0-9a-f]{2}|u00[0-9a-f]{2}(?=[a-z0-9])|%40/gi;

/** Lowercase, strip mailto:/escapes/trailing punctuation, fix freemail typos. Null if hopeless. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let e = String(raw).trim().toLowerCase();
  e = e.replace(/^mailto:/, "").replace(/^(u003e|u003c|%3e|%3c)+/, "").replace(/[\s.,;:!?)>\]}]+$/g, "").replace(/^[<(\[{]+/, "");
  const at = e.lastIndexOf("@");
  if (at <= 0) return e || null;
  const local = e.slice(0, at), domain = e.slice(at + 1).replace(/\.+$/, "");
  return `${local}@${TYPO_DOMAINS[domain] ?? domain}`;
}

function registrable(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  const ccSld = /^(co|com|net|org|ac|gov|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(ccSld ? -3 : -2).join(".");
}

/** Full verdict for one address. `own` = domains known to belong to this artist (optional). */
export function classifyEmail(raw: string | null | undefined): EmailVerdict {
  const email = normalizeEmail(raw) ?? "";
  if (!email || email.length > 120 || !EMAIL_STRICT.test(email)) return { ok: false, email, reason: "invalid syntax" };
  if (FILE_EXT_RE.test(email) || /@\d+x\./.test(email)) return { ok: false, email, reason: "regex artifact (file name)" };
  const [local, domain] = email.split("@");
  const reg = registrable(domain);
  if (PLATFORM_DOMAINS.has(reg) || PLATFORM_DOMAINS.has(domain)) return { ok: false, email, reason: `platform mailbox (${reg})` };
  if (PLACEHOLDER_DOMAIN_RE.test(domain) || PLACEHOLDER_LOCAL_RE.test(local) || PLACEHOLDER_ANY_RE.test(email)) return { ok: false, email, reason: "placeholder address" };
  if (/^[0-9a-f]{16,}$/.test(local) || TRACKING_RE.test(domain)) return { ok: false, email, reason: `tracking/infrastructure host (${domain})` };
  if (DISPOSABLE.has(domain) || DISPOSABLE.has(reg)) return { ok: false, email, reason: `disposable domain (${domain})` };
  if (RELAY_RE.test(domain)) return { ok: false, email, reason: `alias/relay address (${domain})` };
  if (HOSTILE_RE.test(domain)) return { ok: false, email, reason: `hostile domain (${domain})` };
  if (HARD_ROLE_RE.test(local)) return { ok: false, email, reason: `role address (${local}@)` };
  if (SOFT_ROLE_RE.test(local)) {
    if (FREEMAIL_DOMAINS.has(reg)) return { ok: false, email, reason: `role address on freemail (${local}@${reg})` };
    return { ok: true, email, soft: true };
  }
  return { ok: true, email, soft: false };
}

export function isJunkEmail(raw: string | null | undefined): boolean {
  return !classifyEmail(raw).ok;
}

/**
 * Scan free text (bio, page HTML, description) and return the best contactable
 * address: a personal inbox beats a soft-role one; junk is skipped entirely.
 */
export function pickBestEmail(text: string | null | undefined, explicit?: string | null): string | null {
  if (!text && !explicit) return null;
  const clean = String(text ?? "").replace(HTML_ESCAPES_RE, " ");
  const cands = [explicit, ...(clean.match(EMAIL_SCAN_RE) ?? [])].filter(Boolean) as string[];
  let soft: string | null = null;
  const seen = new Set<string>();
  for (const raw of cands) {
    const v = classifyEmail(raw);
    if (!v.ok || seen.has(v.email)) continue;
    seen.add(v.email);
    if (!v.soft) return v.email;
    soft ??= v.email;
  }
  return soft;
}
