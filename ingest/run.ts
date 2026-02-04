/**
 * Phase 2 (hybrid) — Unified ingestion. Chart mirrors first; enterprise APIs pluggable.
 * Any new source must implement IngestionSource. No source writes directly to DB.
 */

import { query, pool } from "@/lib/db";
import type { ChartEntryInput, IngestionSource, IngestResult } from "@/ingest/types";
import { BeatportSource } from "@/ingest/sources/beatport";
import { SongstatsSource } from "@/ingest/songstats";

export const SOURCES: Record<string, IngestionSource> = {
  beatport: BeatportSource,
  songstats: SongstatsSource,
};

export function getAvailableSources(): string[] {
  return Object.keys(SOURCES);
}

async function getOrCreateSourceBySlug(slug: string, name: string): Promise<number> {
  const rows = await query<{ id: number }>("SELECT id FROM sources WHERE slug = $1", [slug]);
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO sources (name, slug) VALUES ($1, $2) RETURNING id",
    [name, slug]
  );
  return (insert.rows[0] as { id: number }).id;
}

async function getOrCreateArtist(name: string): Promise<number> {
  const rows = await query<{ id: number }>("SELECT id FROM artists WHERE name = $1 LIMIT 1", [name]);
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query("INSERT INTO artists (name) VALUES ($1) RETURNING id", [name]);
  return (insert.rows[0] as { id: number }).id;
}

async function getOrCreateLabel(name: string | null | undefined): Promise<number | null> {
  if (!name || name.trim() === "") return null;
  const rows = await query<{ id: number }>("SELECT id FROM labels WHERE name = $1 LIMIT 1", [name.trim()]);
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query("INSERT INTO labels (name) VALUES ($1) RETURNING id", [name.trim()]);
  return (insert.rows[0] as { id: number }).id;
}

async function getOrCreateTrack(
  title: string,
  artistId: number,
  labelId: number | null
): Promise<number> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM tracks WHERE artist_id = $1 AND title = $2 AND (($3::int IS NULL AND label_id IS NULL) OR label_id = $3) LIMIT 1",
    [artistId, title.trim(), labelId]
  );
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO tracks (title, artist_id, label_id) VALUES ($1, $2, $3) RETURNING id",
    [title.trim(), artistId, labelId]
  );
  return (insert.rows[0] as { id: number }).id;
}

function toPosition(entry: ChartEntryInput, index: number): number {
  if (entry.position != null && Number.isFinite(entry.position)) return entry.position;
  return index + 1;
}

/**
 * Idempotent insert: chart_entries with raw fields. ON CONFLICT (source_id, chart_date, position) DO NOTHING.
 */
async function insertChartEntries(
  entries: ChartEntryInput[],
  sourceId: number,
  chartDate: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const artistId = await getOrCreateArtist(entry.artistName);
      const labelId = await getOrCreateLabel(entry.labelName);
      const trackId = await getOrCreateTrack(entry.trackTitle, artistId, labelId);
      const position = toPosition(entry, i);

      const result = await pool.query(
        `INSERT INTO chart_entries (
          source_id, track_id, position, chart_date,
          chart_type, genre, artist_name_raw, track_title_raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (source_id, chart_date, position) DO NOTHING`,
        [
          sourceId,
          trackId,
          position,
          chartDate,
          entry.chartType || null,
          entry.genre ?? null,
          entry.artistName || null,
          entry.trackTitle || null,
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * Run ingestion for a source by slug. Primary: beatport (chart mirror). Optional: songstats.
 */
export async function runIngest(sourceSlug: string, chartDate: string): Promise<IngestResult> {
  const source = SOURCES[sourceSlug];
  if (!source) {
    throw new Error(`Unknown source: ${sourceSlug}. Available: ${getAvailableSources().join(", ")}`);
  }

  const sourceId = await getOrCreateSourceBySlug(sourceSlug, source.sourceName);
  const entries = await source.fetchEntries(chartDate);
  const { inserted, skipped } = await insertChartEntries(entries, sourceId, chartDate);

  return {
    sourceId,
    sourceName: source.sourceName,
    chartDate,
    fetched: entries.length,
    inserted,
    skipped,
  };
}
