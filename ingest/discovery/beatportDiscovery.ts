/**
 * Beatport chart discovery: fetch HTML, parse genres, parse chart links.
 * No headless browser. fetch + cheerio. Retries 2, timeout 15s.
 */

import * as cheerio from "cheerio";

const BEATPORT_ORIGIN = "https://www.beatport.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

export type GenreItem = {
  genre_name: string;
  genre_slug: string;
  genre_url: string;
};

export type ChartLinkItem = {
  url: string;
  title: string | null;
};

/**
 * Fetch HTML with retries and timeout. Throws on failure.
 */
export async function fetchHtml(
  url: string,
  options: { timeout?: number; retries?: number } = {}
): Promise<string> {
  const timeout = options.timeout ?? TIMEOUT_MS;
  const retries = options.retries ?? MAX_RETRIES;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) {
        clearTimeout(timeoutId);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  clearTimeout(timeoutId);
  throw new Error("fetchHtml: max retries exceeded");
}

/**
 * Parse genre index page: extract links to /genre/... (genre_name, slug, url).
 * Expects page with links like <a href="/genre/techno/5">Techno</a> or similar.
 */
export function parseGenres(html: string, baseUrl: string = BEATPORT_ORIGIN): GenreItem[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const genres: GenreItem[] = [];

  $('a[href*="/genre/"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text) return;

    const fullUrl = new URL(href, base).href;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const match = href.match(/\/genre\/([^/]+)(?:\/(\d+))?/i);
    const genre_slug = match ? match[1] : href.replace(/^\//, "").replace(/\/$/, "") || "unknown";
    genres.push({
      genre_name: text,
      genre_slug,
      genre_url: fullUrl,
    });
  });

  return genres;
}

/**
 * Parse a genre page (or charts subpage) for chart links: Top Tracks, Hype, etc.
 * Looks for links to chart-like URLs (e.g. /charts/..., /genre/.../tracks, etc.) and tab/section labels.
 */
export function parseChartLinks(
  html: string,
  baseUrl: string,
  _genre?: GenreItem
): ChartLinkItem[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: ChartLinkItem[] = [];

  const add = (href: string, title: string | null) => {
    const full = new URL(href, base).href;
    if (seen.has(full)) return;
    seen.add(full);
    links.push({ url: full, title });
  };

  $('a[href*="charts"], a[href*="/tracks"], a[href*="/releases"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const title = $(el).text().trim() || null;
    add(href, title);
  });

  if (links.length === 0) {
    $('a[href*="/genre/"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href || !href.includes("/")) return;
      const title = $(el).text().trim() || null;
      if (href.match(/\/tracks|\/releases|\/charts/i)) add(href, title);
    });
  }

  return links;
}

/**
 * Classify chart_family from URL and optional title/h1.
 */
export function classifyChartFamily(url: string, title: string | null): string {
  const u = url.toLowerCase();
  const t = (title ?? "").toLowerCase();
  let family = "unknown";
  if (u.includes("hype") || t.includes("hype")) {
    family = u.includes("release") || t.includes("release") ? "hype_releases" : "hype_tracks";
  } else if (u.includes("top") || t.includes("top")) {
    family = u.includes("release") || t.includes("release") ? "top_releases" : "top_tracks";
  } else if (u.includes("release") || t.includes("release")) {
    family = "top_releases";
  } else if (u.includes("track") || u.includes("tracks") || t.includes("track")) {
    family = "top_tracks";
  } else if (u.includes("chart")) {
    family = "top_tracks";
  }
  return family;
}

export type ChartMeta = {
  chart_family: string;
  genre_slug: string | null;
};

/** Chart entry for ingestion (matches ChartEntryInput shape). */
export type ParsedChartEntry = {
  position: number;
  trackTitle: string;
  artistName: string;
  labelName: string | null;
};

/**
 * Parse chart page HTML into entries (position, track, artist, label).
 * MVP: look for common patterns (data-position, track title link, artist link, label).
 */
export function parseChartEntries(
  html: string,
  _chartMeta: ChartMeta
): ParsedChartEntry[] {
  const $ = cheerio.load(html);
  const entries: ParsedChartEntry[] = [];
  const seen = new Set<string>();

  $("[data-position], .chart-list-item, tr[data-ec-item], .bucket-item, li").each((i, el) => {
    const $el = $(el);
    const pos = parseInt($el.attr("data-position") ?? $el.find("[data-position]").first().attr("data-position") ?? "", 10)
      || parseInt($el.find(".position, .chart-position").first().text().trim(), 10)
      || i + 1;

    const trackTitle =
      $el.find("[data-ec-dtr-detail='track'], .track-title, .title a, a[href*='/track/']").first().text().trim()
      || $el.find("a").filter((_, a) => $(a).attr("href")?.includes("/track/")).first().text().trim();
    const artistName =
      $el.find("[data-ec-dtr-detail='artist'], .artist a, a[href*='/artist/']").first().text().trim()
      || $el.find("a").filter((_, a) => $(a).attr("href")?.includes("/artist/")).first().text().trim();
    const labelName =
      $el.find("[data-ec-dtr-detail='label'], .label a, a[href*='/label/']").first().text().trim()
      || $el.find("a").filter((_, a) => $(a).attr("href")?.includes("/label/")).first().text().trim() || null;

    if (!trackTitle && !artistName) return;
    const key = `${pos}-${trackTitle}-${artistName}`;
    if (seen.has(key)) return;
    seen.add(key);

    entries.push({
      position: Number.isFinite(pos) ? pos : entries.length + 1,
      trackTitle: trackTitle || "Unknown",
      artistName: artistName || "Unknown",
      labelName: labelName || null,
    });
  });

  if (entries.length === 0) {
    $("a[href*='/track/']").each((i, el) => {
      const $a = $(el);
      const trackTitle = $a.text().trim();
      const $row = $a.closest("tr, li, [data-position]");
      const artistName = $row.find("a[href*='/artist/']").first().text().trim() || "Unknown";
      const labelName = $row.find("a[href*='/label/']").first().text().trim() || null;
      if (trackTitle) {
        entries.push({
          position: i + 1,
          trackTitle,
          artistName,
          labelName,
        });
      }
    });
  }

  return entries;
}
