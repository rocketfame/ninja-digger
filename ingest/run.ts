/**
 * v2 — Beatport-only ingestion. Catalog-driven, append-only chart_entries.
 * No artists/tracks normalization; artist_beatport_id is the key.
 */

import { query, pool } from "@/lib/db";
import type { IngestionSource, IngestResult } from "@/ingest/types";
import { BeatportSource } from "@/ingest/sources/beatport";
import { SongstatsSource } from "@/ingest/songstats";
import { fetchHtml, parseChartEntries } from "@/ingest/discovery/beatportDiscovery";
import type { ParsedChartEntry } from "@/ingest/discovery/beatportDiscovery";

export const SOURCES: Record<string, IngestionSource> = {
  beatport: BeatportSource,
  songstats: SongstatsSource,
};

export function getAvailableSources(): string[] {
  return Object.keys(SOURCES);
}

const MAX_ENTRIES_PER_CHART = 100;

type CatalogChartV2 = { id: string; url: string; chart_type: string; genre_slug: string | null };

async function getActiveChartsFromCatalogV2(
  chartTypes?: string[]
): Promise<CatalogChartV2[]> {
  const types = chartTypes?.length
    ? chartTypes
    : ["top_tracks", "hype_tracks"];
  const placeholders = types.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<CatalogChartV2>(
    `SELECT id, url, chart_type, genre_slug FROM charts_catalog
     WHERE platform = 'beatport' AND is_active = true AND chart_type IN (${placeholders})
     ORDER BY genre_slug NULLS LAST, url`,
    types
  );
  return rows;
}

/**
 * Insert parsed entries into chart_entries (v2). Idempotent per (chart_id, snapshot_date, position).
 */
async function insertChartEntriesV2(
  chartId: string,
  snapshotDate: string,
  entries: ParsedChartEntry[]
): Promise<{ inserted: number; skipped: number }> {
  const slice = entries.slice(0, MAX_ENTRIES_PER_CHART);
  let inserted = 0;
  let skipped = 0;

  for (const e of slice) {
    const result = await pool.query(
      `INSERT INTO chart_entries (
        chart_id, snapshot_date, position, track_title, artist_name, artist_slug, artist_beatport_id, label_name, release_title, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'beatport')
      ON CONFLICT (chart_id, snapshot_date, position) DO NOTHING`,
      [
        chartId,
        snapshotDate,
        e.position,
        e.trackTitle || null,
        e.artistName || null,
        e.artistSlug || null,
        e.artistBeatportId || null,
        e.labelName ?? null,
        e.releaseTitle ?? null,
      ]
    );
    if ((result.rowCount ?? 0) > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

/**
 * Beatport v2: load active charts from charts_catalog, fetch each page, parse, append to chart_entries.
 */
async function runBeatportIngestFromCatalog(
  chartDate: string,
  chartTypeFilter?: string[]
): Promise<IngestResult> {
  const charts = await getActiveChartsFromCatalogV2(chartTypeFilter);
  if (charts.length === 0) {
    return {
      sourceId: 0,
      sourceName: "beatport",
      chartDate,
      fetched: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const chart of charts) {
    try {
      const html = await fetchHtml(chart.url);
      const parsed = parseChartEntries(html, {
        chart_family: chart.chart_type,
        genre_slug: chart.genre_slug,
      });
      totalFetched += parsed.length;
      const { inserted, skipped } = await insertChartEntriesV2(chart.id, chartDate, parsed);
      totalInserted += inserted;
      totalSkipped += skipped;
      if (process.env.NODE_ENV !== "test") {
        console.log(`[ingest] ${chart.url} → ${parsed.length} entries (inserted ${inserted}, skipped ${skipped})`);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[ingest] Failed chart ${chart.url}:`, err);
      }
    }
  }

  return {
    sourceId: 0,
    sourceName: "beatport",
    chartDate,
    fetched: totalFetched,
    inserted: totalInserted,
    skipped: totalSkipped,
  };
}

export type RunIngestOptions = {
  /** For beatport: filter by chart_type (e.g. top_tracks, hype_tracks). Default: both. */
  chartFamily?: string[];
};

/**
 * Run ingestion. v2: Beatport only (catalog-driven, append-only chart_entries).
 */
export async function runIngest(
  sourceSlug: string,
  chartDate: string,
  options?: RunIngestOptions
): Promise<IngestResult> {
  const source = SOURCES[sourceSlug];
  if (!source) {
    throw new Error(`Unknown source: ${sourceSlug}. Available: ${getAvailableSources().join(", ")}`);
  }

  if (sourceSlug === "beatport") {
    return runBeatportIngestFromCatalog(chartDate, options?.chartFamily);
  }

  throw new Error("v2: Only beatport ingestion is supported. Other sources (e.g. songstats) are optional later.");
}
