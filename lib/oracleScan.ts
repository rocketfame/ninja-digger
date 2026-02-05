/**
 * Oracle Mode: one-off scan of a chart/source URL.
 * Detects source (Beatport, Beatstats), fetches and parses, returns preview.
 * No cron, no persistence to main discovery — used for "Scan & Extract" in UI.
 */

import {
  fetchHtml,
  parseChartEntries,
  classifyChartFamily,
} from "@/ingest/discovery/beatportDiscovery";
import type { ParsedChartEntry } from "@/ingest/discovery/beatportDiscovery";

export type OracleSource = "beatport" | "beatstats";

export type OracleScanResult =
  | {
      ok: true;
      source: OracleSource;
      type: "chart" | "genre" | "artist_list";
      artists: OracleArtistPreview[];
      chartCount: number;
      genre: string | null;
      sourceUrl: string;
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
    if (host.includes("beatstats")) {
      return { source: "beatstats", type: "chart" };
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

/**
 * Run one-off Oracle scan: fetch URL, parse, return artists + metadata.
 * Beatport: supported. Beatstats: returns unsupported for now.
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
      error: "Unsupported URL. Use a Beatport chart URL or Beatstats (coming soon).",
    };
  }

  if (detected.source === "beatstats") {
    return {
      ok: false,
      source: "beatstats",
      error: "Beatstats ingestion is not yet supported. Use a Beatport chart URL.",
    };
  }

  // Beatport: fetch and parse
  try {
    const html = await fetchHtml(url);
    const genreSlug = extractGenreFromBeatportUrl(url);
    const chartFamily = classifyChartFamily(url, null);
    const entries = parseChartEntries(html, {
      chart_family: chartFamily,
      genre_slug: genreSlug,
    });

    const seen = new Set<string>();
    const artists: OracleArtistPreview[] = [];
    for (const e of entries) {
      const id = e.artistBeatportId || e.artistSlug || e.artistName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      artists.push({
        artist_beatport_id: e.artistBeatportId || "",
        artist_name: e.artistName,
        artist_slug: e.artistSlug,
      });
    }

    return {
      ok: true,
      source: "beatport",
      type: "chart",
      artists,
      chartCount: 1,
      genre: genreSlug,
      sourceUrl: url,
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
