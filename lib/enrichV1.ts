/**
 * Enrichment v1: search-based discovery for Instagram, SoundCloud, Linktree.
 * No headless browser. DuckDuckGo HTML search + fetch + validate.
 * Rate-limited; url_cache for TTL. Public data only.
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
  type: "instagram" | "soundcloud" | "linktree" | "website";
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

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/** Check url_cache; if hit and not expired return body; else fetch, store, return. */
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
    await delay(RATE_DELAY_MS);
    const body = await fetchWithTimeout(normalized);
    await pool.query(
      `INSERT INTO url_cache (url, body, fetched_at, ttl_seconds) VALUES ($1, $2, now(), $3)
       ON CONFLICT (url) DO UPDATE SET body = EXCLUDED.body, fetched_at = now()`,
      [normalized, body.slice(0, 500000), CACHE_TTL_SECONDS]
    );
    return body;
  } catch {
    return null;
  }
}

/** DuckDuckGo HTML search; returns list of result URLs (from snippet/display). */
async function searchDDG(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    await delay(RATE_DELAY_MS);
    const html = await fetchWithTimeout(searchUrl);
    const $ = cheerio.load(html);
    const urls: string[] = [];
    $(".result__a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes("duckduckgo.com")) urls.push(u.href);
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
          new URL(u);
          if (!urls.includes(u)) urls.push(u);
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

function extractEmails(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const mailtos = html.match(/mailto:([^"'\s>]+)/gi) || [];
  for (const m of mailtos) {
    const e = m.replace(/^mailto:/i, "").trim().split(/[?&#]/)[0];
    if (e && e.includes("@") && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  const matches = html.match(EMAIL_REGEX) || [];
  for (const e of matches) {
    const n = e.toLowerCase();
    if (!n.endsWith(".png") && !n.endsWith(".jpg") && !seen.has(n)) {
      seen.add(n);
      out.push(e);
    }
  }
  return out;
}

/** Discover links for an artist (name + optional slug). */
export async function discoverLinks(
  artistName: string,
  artistSlug: string | null
): Promise<{ links: DiscoveredLink[]; contacts: DiscoveredContact[] }> {
  const links: DiscoveredLink[] = [];
  const contacts: DiscoveredContact[] = [];
  const name = artistName.trim() || "artist";
  const slug = (artistSlug || slugify(name)).slice(0, 40);

  const domains = [
    { type: "instagram" as const, query: `${name} site:instagram.com` },
    { type: "soundcloud" as const, query: `${name} site:soundcloud.com` },
    { type: "linktree" as const, query: `${name} linktr.ee OR beacons.ai OR carrd.co` },
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
      const confidence = candidateUrl.includes(slug) ? 0.9 : 0.6;
      links.push({ type, url, confidence, source: "search" });
      if (type === "linktree") {
        const emails = extractEmails(html);
        for (const email of emails.slice(0, 3)) {
          contacts.push({
            type: "email",
            value: email,
            source_url: candidateUrl,
            confidence: 0.5,
          });
        }
      }
      break; // one URL per type
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
         VALUES ($1, $2, $3, $4, $5)`,
        [artistBeatportId, c.type, c.value, c.source_url, c.confidence]
      );
      contactsAdded++;
    }
  } catch (e) {
    return { linksAdded, contactsAdded, error: String(e) };
  }
  return { linksAdded, contactsAdded };
}
