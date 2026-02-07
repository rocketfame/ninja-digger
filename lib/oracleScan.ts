/**
 * Oracle Mode: one-off scan of a chart/source URL.
 * Sources: Beatport, BP Top Tracker (retro by day), Beatstats (trending by period).
 */

import * as cheerio from "cheerio";
import {
  fetchHtml,
  parseChartEntries,
  classifyChartFamily,
} from "@/ingest/discovery/beatportDiscovery";
import type { ParsedChartEntry } from "@/ingest/discovery/beatportDiscovery";
import {
  looksLikeLoginOrLandingPage,
  isBlockedArtist,
  isBlockedTrack,
} from "@/lib/bptoptrackerBlocklist";

const BEATPORT_ORIGIN = "https://www.beatport.com";
const BPTOTRACKER_ORIGIN = "https://www.bptoptracker.com";

export type OracleSource = "beatport" | "beatstats" | "bptoptracker";

export type OracleChartMeta = {
  genre: string | null;
  chartType: string;
  sourceUrl: string;
};

export type OracleScanItem = {
  artist_beatport_id: string;
  artist_name: string;
  artist_url: string;
  track_name: string;
  track_url: string | null;
  rank: number;
  raw_json: Record<string, unknown>;
};

export type OracleScanResult =
  | {
      ok: true;
      source: OracleSource;
      chartMeta: OracleChartMeta;
      items: OracleScanItem[];
      counts: { charts: number; tracks: number; artists: number };
    }
  | {
      ok: false;
      source: OracleSource | null;
      error: string;
    };

export type OracleArtistPreview = {
  artist_beatport_id: string;
  artist_name: string;
  artist_slug: string;
};

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/**
 * Detect source and page type from URL.
 */
export function detectSource(url: string): { source: OracleSource; type: "chart" | "genre" | "artist_list" } | null {
  const u = normalizeUrl(url);
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host.includes("beatport.com")) {
      if (path.includes("/genre/") && (path.includes("/tracks") || path.includes("/top") || path.includes("/hype") || /\/\d+\/?$/.test(path)))
        return { source: "beatport", type: "chart" };
      if (path.includes("/genre/")) return { source: "beatport", type: "genre" };
      if (path.includes("/artist/") || path.includes("/chart")) return { source: "beatport", type: "chart" };
      return { source: "beatport", type: "chart" };
    }
    if (host.includes("bptoptracker.com")) {
      return { source: "bptoptracker", type: "chart" };
    }
    if (host.includes("beatstats.com")) {
      return { source: "beatstats", type: path.includes("artist") ? "artist_list" : "chart" };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Extract genre slug from Beatport URL path, e.g. /genre/techno/5/top-100 → techno */
function extractGenreFromBeatportUrl(url: string): string | null {
  const match = url.match(/\/genre\/([^/]+)/i);
  return match ? match[1] : null;
}

/** Fetch HTML; for bptoptracker use cookie from env or login. */
async function fetchForSource(url: string, source: OracleSource): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  };
  if (source === "bptoptracker") {
    const { getBptoptrackerCookie } = await import("@/lib/bptoptrackerAuth");
    const cookie = await getBptoptrackerCookie();
    if (cookie) headers.Cookie = cookie;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** BP Top Tracker: /top/track/afro-house/2026-02-03 — table with Rank, Title, Artists, Label, Released. */
function parseBptoptrackerChart(html: string, pageUrl: string): { items: OracleScanItem[]; genre: string; date: string } {
  if (looksLikeLoginOrLandingPage(html)) {
    throw new Error(
      "BP Top Tracker повернув сторінку логіну або головну. Перевір BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env."
    );
  }
  const $ = cheerio.load(html);
  const genreMatch = pageUrl.match(/\/top\/track\/([^/]+)\/(\d{4}-\d{2}-\d{2})/i);
  const genre = genreMatch ? genreMatch[1] : "unknown";
  const date = genreMatch ? genreMatch[2] : "";

  const items: OracleScanItem[] = [];
  const seen = new Set<string>();

  $("table tbody tr, .chart-table tbody tr, tbody tr").each((_, row) => {
    const $row = $(row);
    const tds = $row.find("td");
    if (tds.length < 3) return;
    const texts = tds.map((__, td) => $(td).text().trim()).get();
    const rankNum = parseInt(texts[0], 10);
    if (!Number.isFinite(rankNum) || rankNum < 1 || rankNum > 200) return;
    let title = "";
    let artists = "";
    let label = "";
    let released = "";
    let movement = "";
    if (texts.length >= 5) {
      title = (texts[1] ?? texts[2] ?? "").replace(/[↑↓→]\d*/g, "").trim();
      artists = texts[2] ?? texts[3] ?? "";
      label = texts[3] ?? texts[4] ?? "";
      released = texts[4] ?? texts[5] ?? "";
      movement = texts[1]?.match(/[↑↓→]\d*/)?.[0] ?? "";
    } else {
      title = $row.find("[class*='title'], [class*='track']").first().text().trim();
      artists = $row.find("[class*='artist']").first().text().trim();
      label = $row.find("[class*='label']").first().text().trim();
      released = $row.find("[class*='release']").first().text().trim();
    }
    const primaryArtist = artists.split(",").map((a) => a.trim()).filter(Boolean)[0]?.trim() || "";
    if (isBlockedArtist(primaryArtist) || isBlockedTrack(title)) return;
    const key = `${rankNum}-${title}-${primaryArtist}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      artist_beatport_id: "",
      artist_name: primaryArtist,
      artist_url: "",
      track_name: title || "—",
      track_url: null,
      rank: rankNum,
      raw_json: {
        artists_full: artists,
        label,
        released,
        movement,
        genre,
        date,
        source: "bptoptracker",
      } as Record<string, unknown>,
    });
  });

  if (items.length === 0) {
    throw new Error("Не знайдено валідних рядків чарту. Можливо сторінка логіну або змінилась структура.");
  }
  return { items, genre, date };
}

/** Beatstats: artist list by genre + period (e.g. genre=89, period=21). */
function parseBeatstatsArtistList(html: string, pageUrl: string): { items: OracleScanItem[]; genre: string; period: string } {
  if (/login|sign in|email/i.test(html) && html.length < 6000) {
    throw new Error("Beatstats returned login page. Add session cookie via BEATSTATS_COOKIE in env if the site requires auth.");
  }
  const $ = cheerio.load(html);
  const genre = new URL(pageUrl).searchParams.get("genre") ?? "";
  const period = new URL(pageUrl).searchParams.get("period") ?? "";

  const items: OracleScanItem[] = [];
  const seen = new Set<string>();
  let rank = 0;
  $("table tbody tr, [class*='artist'] a, a[href*='/artist/']").each((_, el) => {
    const $el = $(el);
    const name = $el.text().trim();
    const href = $el.attr("href") ?? "";
    if (!name || name.length < 2 || name.length > 120) return;
    if (seen.has(name)) return;
    seen.add(name);
    rank++;
    items.push({
      artist_beatport_id: "",
      artist_name: name,
      artist_url: href.startsWith("http") ? href : `https://www.beatstats.com${href.startsWith("/") ? "" : "/"}${href}`,
      track_name: "",
      track_url: null,
      rank,
      raw_json: { genre, period, source: "beatstats" } as Record<string, unknown>,
    });
  });

  return { items, genre, period };
}

/**
 * Run one-off Oracle scan: fetch URL, parse, return artists + metadata.
 * Beatport, BP Top Tracker (retro by day), Beatstats (trending by period) supported.
 */
export async function runOracleScan(inputUrl: string): Promise<OracleScanResult> {
  const url = normalizeUrl(inputUrl);
  if (!url) {
    return { ok: false, source: null, error: "URL is required." };
  }

  const detected = detectSource(url);
  if (!detected) {
    return {
      ok: false,
      source: null,
      error: "Unsupported URL. Use Beatport, BP Top Tracker (bptoptracker.com), or Beatstats chart/artist URL.",
    };
  }

  // BP Top Tracker: retrospective by day (genre + date)
  if (detected.source === "bptoptracker") {
    try {
      if (process.env.NODE_ENV !== "test") console.log("[oracle/scan] source: bptoptracker, fetching:", url);
      const html = await fetchForSource(url, "bptoptracker");
      const { items, genre, date } = parseBptoptrackerChart(html, url);
      const artistNames = new Set(items.map((i) => i.artist_name).filter(Boolean));
      if (process.env.NODE_ENV !== "test") console.log("[oracle/scan] bptoptracker parsed:", items.length, "items,", artistNames.size, "artists");
      return {
        ok: true,
        source: "bptoptracker",
        chartMeta: {
          genre,
          chartType: `top_${date}`,
          sourceUrl: url,
        },
        items,
        counts: { charts: 1, tracks: items.length, artists: artistNames.size },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, source: "bptoptracker", error: message };
    }
  }

  // Beatstats: trending artists by genre + period
  if (detected.source === "beatstats") {
    try {
      if (process.env.NODE_ENV !== "test") console.log("[oracle/scan] source: beatstats, fetching:", url);
      const cookie = process.env.BEATSTATS_COOKIE;
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const { items, genre, period } = parseBeatstatsArtistList(html, url);
      const artistNames = new Set(items.map((i) => i.artist_name).filter(Boolean));
      if (process.env.NODE_ENV !== "test") console.log("[oracle/scan] beatstats parsed:", items.length, "artists");
      return {
        ok: true,
        source: "beatstats",
        chartMeta: {
          genre: genre || null,
          chartType: `artists_period_${period}`,
          sourceUrl: url,
        },
        items,
        counts: { charts: 0, tracks: 0, artists: artistNames.size },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, source: "beatstats", error: message };
    }
  }

  // Beatport: fetch and parse
  try {
    const genreSlug = extractGenreFromBeatportUrl(url);
    const chartFamily = classifyChartFamily(url, null);
    if (process.env.NODE_ENV !== "test") {
      console.log("[oracle/scan] source detected: beatport, fetching:", url);
    }
    const html = await fetchHtml(url);
    if (process.env.NODE_ENV !== "test") {
      console.log("[oracle/scan] fetched, length:", html?.length ?? 0);
    }
    const entries = parseChartEntries(html, {
      chart_family: chartFamily,
      genre_slug: genreSlug,
    });

    const artistUrl = (slug: string, id: string) => {
      const s = (slug || "artist").replace(/^\/+|\/+$/g, "");
      return `${BEATPORT_ORIGIN}/artist/${s}/${id || ""}`.replace(/\/+$/, "") as string;
    };
    const items: OracleScanItem[] = entries.map((e) => ({
      artist_beatport_id: e.artistBeatportId || "",
      artist_name: e.artistName,
      artist_url: artistUrl(e.artistSlug, e.artistBeatportId),
      track_name: e.trackTitle,
      track_url: null,
      rank: e.position,
      raw_json: {
        artist_slug: e.artistSlug,
        label_name: e.labelName,
        release_title: e.releaseTitle,
      } as Record<string, unknown>,
    }));

    const artistIds = new Set(items.map((i) => i.artist_beatport_id || i.artist_name).filter(Boolean));
    if (process.env.NODE_ENV !== "test") {
      console.log("[oracle/scan] parsed entries:", entries.length, "items:", items.length, "artists:", artistIds.size);
    }

    return {
      ok: true,
      source: "beatport",
      chartMeta: {
        genre: genreSlug,
        chartType: chartFamily,
        sourceUrl: url,
      },
      items,
      counts: {
        charts: 1,
        tracks: items.length,
        artists: artistIds.size,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      source: "beatport",
      error: message,
    };
  }
}
