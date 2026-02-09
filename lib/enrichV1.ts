/**
 * Enrichment v1: search-based discovery for соціальні мережі, нішові сайти музикантів, контакти.
 *
 * ЩО ШУКАЄМО (пошук: DuckDuckGo HTML → Bing → Startpage, без браузера):
 * - Instagram, SoundCloud, Linktree/Beacons/Carrd, Resident Advisor — як раніше.
 * - Bandcamp: "Artist Name" site:bandcamp.com → артисти/лейбли, часто є контакт у біо.
 * - Mixcloud: "Artist Name" site:mixcloud.com → DJ-профілі, контакти в описі.
 * - Reverb Nation: "Artist Name" site:reverbnation.com → профілі музикантів.
 * - SoundCloud: з профілю та опису витягуємо максимум email (часто є в біо); додатково пошук "Artist soundcloud email contact".
 *
 * ЩО ЗАПОВНЮЄМО:
 * - artist_links: один ряд на тип (instagram, soundcloud, linktree, resident_advisor, bandcamp, mixcloud, reverbnation, website).
 * - artist_contacts: email з усіх зібраних сторінок; source_url = звідки знайшли; для SoundCloud/Linktree трохи вища впевненість.
 *
 * Обмеження: rate limit 2 с, кеш URL 24 год, перевірка nameMatches. Публічні дані лише.
 */

import * as cheerio from "cheerio";
import { query, pool } from "@/lib/db";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const RATE_DELAY_MS = 2000;
const CACHE_TTL_SECONDS = 86400; // 24h
const REQUEST_TIMEOUT_MS = 12000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type DiscoveredLink = {
  type: "instagram" | "soundcloud" | "linktree" | "website" | "resident_advisor" | "bandcamp" | "mixcloud" | "reverbnation";
  url: string;
  confidence: number;
  source: string;
};

export type DiscoveredContact = {
  type: "email";
  value: string;
  source_url: string | null;
  confidence: number;
};

const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: "https://duckduckgo.com/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
} as const;

async function fetchWithTimeout(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/** Check url_cache; if hit and not expired return body; else fetch, store (if DB ok), return. Falls back to fetchWithoutCache when DB unavailable. */
async function fetchWithCache(url: string): Promise<string | null> {
  const normalized = url.trim();
  if (!normalized) return null;
  try {
    const rows = await query<{ body: string | null; fetched_at: Date; ttl_seconds: number }>(
      `SELECT body, fetched_at, ttl_seconds FROM url_cache WHERE url = $1`,
      [normalized]
    );
    const row = rows[0];
    if (row?.body) {
      const age = (Date.now() - new Date(row.fetched_at).getTime()) / 1000;
      if (age < (row.ttl_seconds ?? CACHE_TTL_SECONDS)) return row.body;
    }
  } catch {
    // No DB or no table: skip cache, fetch below
  }
  try {
    await delay(RATE_DELAY_MS);
    const body = await fetchWithTimeout(normalized);
    try {
      await pool.query(
        `INSERT INTO url_cache (url, body, fetched_at, ttl_seconds) VALUES ($1, $2, now(), $3)
         ON CONFLICT (url) DO UPDATE SET body = EXCLUDED.body, fetched_at = now()`,
        [normalized, body.slice(0, 500000), CACHE_TTL_SECONDS]
      );
    } catch {
      // Cache write failed; still return body
    }
    return body;
  } catch {
    return null;
  }
}

/** Extract real URL from DuckDuckGo redirect link (duckduckgo.com/l/?uddg=...). */
function unwrapDDGRedirect(href: string): string | null {
  if (!href || !href.includes("uddg=")) return null;
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (!uddg) return null;
    const decoded = decodeURIComponent(uddg);
    const target = new URL(decoded);
    if (target.hostname.includes("duckduckgo.com")) return null;
    return target.href;
  } catch {
    return null;
  }
}

/** Bing HTML search fallback; returns result URLs. */
async function searchBing(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://www.bing.com/search?q=${encoded}&count=15`;
  try {
    await delay(RATE_DELAY_MS);
    const html = await fetchWithTimeout(searchUrl, { Referer: "https://www.bing.com/" });
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];
    $(".b_algo h2 a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes("bing.com") && !u.hostname.includes("microsoft.com") && !seen.has(u.href)) {
            seen.add(u.href);
            urls.push(u.href);
          }
        } catch {
          // skip
        }
      }
    });
    return urls;
  } catch {
    return [];
  }
}

/** Startpage HTML search fallback; returns result URLs. */
async function searchStartpage(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://www.startpage.com/sp/search?query=${encoded}`;
  try {
    await delay(RATE_DELAY_MS);
    const html = await fetchWithTimeout(searchUrl, { Referer: "https://www.startpage.com/" });
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];
    $("h3.clk a, .w-gl__result-url").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes("startpage.com") && !seen.has(u.href)) {
            seen.add(u.href);
            urls.push(u.href);
          }
        } catch {
          // skip
        }
      }
    });
    return urls;
  } catch {
    return [];
  }
}

/** Extract real URLs from DDG HTML by finding uddg= in raw HTML (fallback when selectors miss). */
function extractUddgUrlsFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const re = /uddg=([^&"'\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(m[1]);
      const u = new URL(decoded);
      if (!u.hostname.includes("duckduckgo.com") && !seen.has(u.href)) {
        seen.add(u.href);
        urls.push(u.href);
      }
    } catch {
      // skip
    }
  }
  return urls;
}

/** DuckDuckGo HTML search; returns list of result URLs. Supports current DDG (redirect links uddg=) and legacy .result__a/.result__url. Regex fallback for uddg= in raw HTML. Falls back to Bing if DDG returns nothing. */
async function searchDDG(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    await delay(RATE_DELAY_MS);
    const html = await fetchWithTimeout(searchUrl);
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];

    // Current DDG: results are links to duckduckgo.com/l/?uddg=ENCODED_REAL_URL
    $("a[href*='duckduckgo.com/l/']").each((_, el) => {
      const href = $(el).attr("href");
      const real = href ? unwrapDDGRedirect(href) : null;
      if (real && !seen.has(real)) {
        seen.add(real);
        urls.push(real);
      }
    });

    $("a[href*='uddg=']").each((_, el) => {
      const href = $(el).attr("href");
      const fullHref = href?.startsWith("http") ? href : (href ? new URL(href, "https://duckduckgo.com").href : "");
      const real = fullHref ? unwrapDDGRedirect(fullHref) : null;
      if (real && !seen.has(real)) {
        seen.add(real);
        urls.push(real);
      }
    });

    // Fallback: scan raw HTML for uddg= (handles different DOM or encoded links)
    if (urls.length === 0) {
      for (const real of extractUddgUrlsFromHtml(html)) {
        if (!seen.has(real)) {
          seen.add(real);
          urls.push(real);
        }
      }
    }

    // Legacy: direct result links and .result__url text
    if (urls.length === 0) {
      $(".result__a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          try {
            const u = new URL(href);
            if (!u.hostname.includes("duckduckgo.com") && !seen.has(u.href)) {
              seen.add(u.href);
              urls.push(u.href);
            }
          } catch {
            // skip
          }
        }
      });
      $(".result__url").each((_, el) => {
        const text = $(el).text().trim();
        if (text && /^[\w.-]+\.[a-z]{2,}/i.test(text)) {
          const u = text.startsWith("http") ? text : `https://${text}`;
          try {
            const parsed = new URL(u);
            if (!seen.has(parsed.href)) {
              seen.add(parsed.href);
              urls.push(parsed.href);
            }
          } catch {
            // skip
          }
        }
      });
    }

    if (urls.length === 0) {
      const bingUrls = await searchBing(q);
      if (bingUrls.length > 0) return bingUrls;
      const startUrls = await searchStartpage(q);
      return startUrls;
    }
    return urls;
  } catch {
    const bingUrls = await searchBing(q);
    if (bingUrls.length > 0) return bingUrls;
    return searchStartpage(q);
  }
}

/** For tests: run search and return URLs (DDG then Bing fallback). */
export async function getSearchResultUrls(q: string): Promise<string[]> {
  return searchDDG(q);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "artist";
}

function nameMatches(html: string, artistName: string): boolean {
  const lower = html.toLowerCase();
  const terms = artistName.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3);
  return terms.length === 0 || terms.some((t) => t.length > 2 && lower.includes(t));
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Нижній регістр для дедуплікації; false якщо це явно не контакт артиста. */
function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase().split(/[?&#\s]/)[0];
  if (!e || !e.includes("@") || e.length > 254) return null;
  if (e.endsWith(".png") || e.endsWith(".jpg") || e.endsWith(".gif") || e.endsWith(".webp")) return null;
  const noReply = /^(noreply|no-reply|donotreply|do-not-reply|newsletter|notifications|webmaster)@/i;
  if (noReply.test(e)) return null;
  return e;
}

/** Витягує email з HTML; повертає унікальні нормалізовані з позначкою чи з mailto: (вища впевненість). */
function extractEmails(html: string): { value: string; fromMailto: boolean }[] {
  const seen = new Set<string>();
  const out: { value: string; fromMailto: boolean }[] = [];
  const mailtos = html.match(/mailto:([^"'\s>]+)/gi) || [];
  for (const m of mailtos) {
    const e = normalizeEmail(m.replace(/^mailto:/i, "").trim());
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push({ value: e, fromMailto: true });
    }
  }
  const matches = html.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const e = normalizeEmail(raw);
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push({ value: e, fromMailto: false });
    }
  }
  return out;
}

/** Збирає email з усіх зібраних сторінок (Linktree, SoundCloud, контакт-пошук) з пріоритетом за джерелом. */
function collectContactsFromPages(
  contacts: DiscoveredContact[],
  sourceUrl: string,
  html: string,
  options: { confidenceMailto: number; confidencePlain: number; maxPerPage: number }
): void {
  const extracted = extractEmails(html).slice(0, options.maxPerPage);
  const seen = new Set(contacts.map((c) => c.value.toLowerCase()));
  for (const { value, fromMailto } of extracted) {
    if (seen.has(value)) continue;
    seen.add(value);
    contacts.push({
      type: "email",
      value,
      source_url: sourceUrl,
      confidence: fromMailto ? options.confidenceMailto : options.confidencePlain,
    });
  }
}

/** Phase 1 confidence by source (email). Links use slug-in-url boost on top of base. */
const EMAIL_CONFIDENCE: Record<string, { mailto: number; plain: number }> = {
  resident_advisor: { mailto: 0.95, plain: 0.95 },
  linktree: { mailto: 0.9, plain: 0.9 },
  bandcamp: { mailto: 0.85, plain: 0.85 },
  soundcloud: { mailto: 0.8, plain: 0.8 },
  instagram: { mailto: 0.7, plain: 0.7 },
};

/** Only these sources may contribute email (Phase 1: no search-engine email scraping). */
const EMAIL_SOURCES = new Set(["linktree", "resident_advisor", "soundcloud", "bandcamp"]);

/** Classify href to our link type; null if not a tracked type. */
function linkTypeFromHref(href: string): DiscoveredLink["type"] | null {
  try {
    const h = href.toLowerCase();
    if (/instagram\.com\/[^/?#]+/.test(h)) return "instagram";
    if (/linktr\.ee\/[^/?#]+/.test(h) || /beacons\.ai\/[^/?#]+/.test(h) || /carrd\.co\/[^/?#]+/.test(h)) return "linktree";
    if (/soundcloud\.com\/[^/?#]+/.test(h)) return "soundcloud";
    if (/residentadvisor\.net\/[^/?#]+/.test(h)) return "resident_advisor";
    if (/bandcamp\.com\/[^/?#]+/.test(h)) return "bandcamp";
    if (/mixcloud\.com\/[^/?#]+/.test(h)) return "mixcloud";
    if (/reverbnation\.com\/[^/?#]+/.test(h)) return "reverbnation";
    if (/^https?:\/\/[^/]+(\/|$)/.test(h) && !/instagram|linktr|beacons|carrd|soundcloud|residentadvisor|bandcamp|mixcloud|reverbnation|duckduckgo|google|facebook|twitter|x\.com/i.test(h)) return "website";
  } catch {
    return null;
  }
  return null;
}

/** Extract external links from HTML and add cross-validated ones if URL path matches name/slug. */
function addCrossValidatedLinks(
  links: DiscoveredLink[],
  html: string,
  parentSource: string,
  name: string,
  slug: string,
  baseConfidence: number
): void {
  const $ = cheerio.load(html);
  const seenTypes = new Set(links.map((l) => l.type));
  const terms = name.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const type = linkTypeFromHref(href);
    if (!type || seenTypes.has(type)) return;
    try {
      const u = new URL(href);
      const pathSlug = u.pathname.replace(/^\/|\/$/g, "").split("/")[0] || "";
      const pathLower = u.pathname.toLowerCase();
      const hostLower = u.hostname.toLowerCase();
      const pathMatches = pathSlug && (pathSlug.toLowerCase().includes(slug.toLowerCase()) || terms.some((t) => pathLower.includes(t)));
      const siteMatches = type === "website" && terms.some((t) => pathLower.includes(t) || hostLower.includes(t));
      if (!pathMatches && !siteMatches) return;
      let url = u.origin + u.pathname.replace(/\/$/, "") || href;
      if (url.length > 500) return;
      links.push({ type, url, confidence: baseConfidence, source: `cross_validated:${parentSource}` });
      seenTypes.add(type);
    } catch {
      // skip invalid URL
    }
  });
}

/** Discover links for an artist. Phase 1: priority order, one search per type, cross-validation, email only from 4 sources. */
export async function discoverLinks(
  artistName: string,
  artistSlug: string | null
): Promise<{ links: DiscoveredLink[]; contacts: DiscoveredContact[] }> {
  const links: DiscoveredLink[] = [];
  const contacts: DiscoveredContact[] = [];
  const name = artistName.trim() || "artist";
  const slug = (artistSlug || slugify(name)).slice(0, 40);
  const quotedName = name.includes(" ") ? `"${name}"` : name;

  // Phase 1 order: 1 Linktree 2 RA 3 SoundCloud 4 Bandcamp 5 Mixcloud 6 Reverb Nation 7 Instagram
  const domains: { type: DiscoveredLink["type"]; query: string }[] = [
    { type: "linktree", query: `${quotedName} linktr.ee OR beacons.ai OR carrd.co` },
    { type: "resident_advisor", query: `${quotedName} site:residentadvisor.net` },
    { type: "soundcloud", query: `${quotedName} site:soundcloud.com` },
    { type: "bandcamp", query: `${quotedName} site:bandcamp.com` },
    { type: "mixcloud", query: `${quotedName} site:mixcloud.com` },
    { type: "reverbnation", query: `${quotedName} site:reverbnation.com` },
    { type: "instagram", query: `${quotedName} site:instagram.com` },
  ];

  for (const { type, query: q } of domains) {
    const resultUrls = await searchDDG(q);
    for (const candidateUrl of resultUrls.slice(0, 2)) {
      const html = await fetchWithCache(candidateUrl);
      if (!html) continue;
      if (!nameMatches(html, name)) continue;
      let url = candidateUrl;
      try {
        const u = new URL(candidateUrl);
        url = u.origin + u.pathname.replace(/\/$/, "") || candidateUrl;
      } catch {
        // keep as is
      }
      const linkConfidence = candidateUrl.includes(slug) ? 0.9 : 0.6;
      links.push({ type, url, confidence: linkConfidence, source: "search" });

      // Email only from Linktree, RA, SoundCloud, Bandcamp (Phase 1)
      if (EMAIL_SOURCES.has(type)) {
        const conf = EMAIL_CONFIDENCE[type] ?? { mailto: 0.7, plain: 0.7 };
        collectContactsFromPages(contacts, candidateUrl, html, {
          confidenceMailto: conf.mailto,
          confidencePlain: conf.plain,
          maxPerPage: type === "soundcloud" ? 6 : 5,
        });
      }

      // Cross-validation: extract external links from SoundCloud, RA, Linktree
      if (type === "soundcloud" || type === "resident_advisor" || type === "linktree") {
        addCrossValidatedLinks(links, html, type, name, slug, 0.75);
      }
      break;
    }
  }

  return { links, contacts };
}

/** Run enrichment for one artist; upsert artist_links and artist_contacts. */
export async function runEnrichmentForArtist(artistBeatportId: string): Promise<{
  linksAdded: number;
  contactsAdded: number;
  error?: string;
}> {
  let artistName = "";
  let artistSlug: string | null = null;
  try {
    const rows = await query<{ artist_name: string | null; artist_slug: string | null }>(
      `SELECT am.artist_name,
              (SELECT ce.artist_slug FROM chart_entries ce WHERE ce.artist_beatport_id = am.artist_beatport_id AND ce.artist_slug IS NOT NULL LIMIT 1) AS artist_slug
       FROM artist_metrics am WHERE am.artist_beatport_id = $1`,
      [artistBeatportId]
    );
    const r = rows[0];
    artistName = r?.artist_name ?? "";
    artistSlug = r?.artist_slug ?? null;
    if (!artistName && !artistSlug) {
      const ceRows = await query<{ artist_name: string; artist_slug: string | null }>(
        `SELECT artist_name, artist_slug FROM chart_entries WHERE artist_beatport_id = $1 LIMIT 1`,
        [artistBeatportId]
      );
      artistName = ceRows[0]?.artist_name ?? "";
      artistSlug = ceRows[0]?.artist_slug ?? null;
    }
  } catch (e) {
    return { linksAdded: 0, contactsAdded: 0, error: String(e) };
  }

  const { links, contacts } = await discoverLinks(artistName, artistSlug);

  let linksAdded = 0;
  let contactsAdded = 0;
  try {
    for (const link of links) {
      await pool.query(
        `INSERT INTO artist_links (artist_beatport_id, type, url, confidence, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (artist_beatport_id, type) DO UPDATE SET url = EXCLUDED.url, confidence = EXCLUDED.confidence, source = EXCLUDED.source`,
        [artistBeatportId, link.type, link.url, link.confidence, link.source]
      );
      linksAdded++;
    }
    for (const c of contacts) {
      await pool.query(
        `INSERT INTO artist_contacts (artist_beatport_id, type, value, source_url, confidence)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (artist_beatport_id, type, value) DO UPDATE SET
           source_url = COALESCE(EXCLUDED.source_url, artist_contacts.source_url),
           confidence = GREATEST(artist_contacts.confidence, EXCLUDED.confidence)`,
        [artistBeatportId, c.type, c.value, c.source_url, c.confidence]
      );
      contactsAdded++;
    }
  } catch (e) {
    return { linksAdded, contactsAdded, error: String(e) };
  }
  return { linksAdded, contactsAdded };
}
