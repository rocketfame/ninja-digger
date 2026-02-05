/**
 * Sync bptoptracker_daily → chart_entries for artists we can match to artist_beatport_id.
 * Then run normalize + score so they appear in lead_scores.
 * One chart per genre in charts_catalog (platform=bptoptracker).
 */

import { pool, query } from "@/lib/db";

async function getOrCreateBptoptrackerChartId(genreSlug: string): Promise<string> {
  const url = `https://bptoptracker.com/top/track/${genreSlug}`;
  const existing = await query<{ id: string }>(
    `SELECT id FROM charts_catalog WHERE platform = 'bptoptracker' AND url = $1`,
    [url]
  );
  if (existing.length > 0) return existing[0].id;
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO charts_catalog (platform, chart_type, genre_slug, url, is_active, discovered_at, last_checked_at)
     VALUES ('bptoptracker', 'top_tracks', $1, $2, true, CURRENT_DATE, CURRENT_DATE)
     RETURNING id`,
    [genreSlug, url]
  );
  const id = ins.rows[0]?.id;
  if (!id) throw new Error("Failed to create bptoptracker chart");
  return id;
}

/**
 * For each row in bptoptracker_daily, resolve artist_beatport_id (manual link or artist_metrics match).
 * Insert into chart_entries with bptoptracker chart_id. Idempotent per (chart_id, snapshot_date, position).
 */
export async function syncBptoptrackerToChartEntries(): Promise<{
  chartEntriesInserted: number;
  artistsMatched: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let chartEntriesInserted = 0;
  const matchedArtistIds = new Set<string>();

  const rows = await query<{
    snapshot_date: string;
    genre_slug: string;
    position: number;
    track_title: string | null;
    artist_name: string;
    label_name: string | null;
    released: string | null;
  }>(
    `SELECT snapshot_date::text, genre_slug, position, track_title, artist_name, label_name, released
     FROM bptoptracker_daily ORDER BY snapshot_date, genre_slug, position`
  );

  const genreChartIds = new Map<string, string>();
  for (const row of rows) {
    let chartId = genreChartIds.get(row.genre_slug);
    if (!chartId) {
      try {
        chartId = await getOrCreateBptoptrackerChartId(row.genre_slug);
        genreChartIds.set(row.genre_slug, chartId);
      } catch (e) {
        errors.push(`genre ${row.genre_slug}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
    }

    const artistBeatportId = await resolveArtistBeatportId(row.artist_name);
    if (!artistBeatportId) continue;

    matchedArtistIds.add(artistBeatportId);
    try {
      const result = await pool.query(
        `INSERT INTO chart_entries (chart_id, snapshot_date, position, track_title, artist_name, artist_beatport_id, label_name, release_title, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'bptoptracker')
         ON CONFLICT (chart_id, snapshot_date, position) DO NOTHING`,
        [
          chartId,
          row.snapshot_date,
          row.position,
          row.track_title,
          row.artist_name,
          artistBeatportId,
          row.label_name,
          row.released,
        ]
      );
      if ((result.rowCount ?? 0) > 0) chartEntriesInserted++;
    } catch (e) {
      errors.push(`${row.artist_name} ${row.snapshot_date}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    chartEntriesInserted,
    artistsMatched: matchedArtistIds.size,
    errors: errors.slice(0, 50),
  };
}

async function resolveArtistBeatportId(artistName: string): Promise<string | null> {
  const trimmed = artistName.trim();
  if (!trimmed) return null;
  const manual = await query<{ artist_beatport_id: string }>(
    `SELECT artist_beatport_id FROM bptoptracker_artist_links WHERE artist_name = $1`,
    [trimmed]
  );
  if (manual.length > 0) return manual[0].artist_beatport_id;
  const match = await query<{ artist_beatport_id: string }>(
    `SELECT artist_beatport_id FROM artist_metrics WHERE LOWER(TRIM(artist_name)) = LOWER($1) LIMIT 1`,
    [trimmed]
  );
  return match.length > 0 ? match[0].artist_beatport_id : null;
}
