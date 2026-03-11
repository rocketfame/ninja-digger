/**
 * Daily update: fetch today (and yesterday) for BPTOPTRACKER_GENRES and insert into bptoptracker_daily.
 * When BPTOPTRACKER_GENRES is empty, uses full genre list from code.
 */

import { pool } from "@/lib/db";
import { getBptoptrackerGenresForSync } from "./bptoptrackerGenres";
import { fetchChartForDate } from "./bptoptrackerFetch";

const DELAY_MS = 1500;

export async function runBptoptrackerDailyUpdate(): Promise<{
  genres: string[];
  dates: string[];
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const genres = getBptoptrackerGenresForSync();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
  const dates = [yesterday, today];

  return runBptoptrackerForDateRange(genres, dates);
}

/** Fetch BPTT for given genres and dates; insert into bptoptracker_daily. Used by refresh-now (fill missing days). */
export async function runBptoptrackerForDateRange(
  genreSlugs: string[],
  dates: string[]
): Promise<{ genres: string[]; dates: string[]; inserted: number; skipped: number; errors: string[] }> {
  if (genreSlugs.length === 0 || dates.length === 0) {
    return { genres: genreSlugs, dates, inserted: 0, skipped: 0, errors: [] };
  }

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  const hasArtistIdColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_beatport_id' LIMIT 1`
  );
  const hasLinkPathColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_link_path' LIMIT 1`
  );
  const withArtistId = hasArtistIdColumn.rows.length > 0;
  const withLinkPath = hasLinkPathColumn.rows.length > 0;

  for (const genreSlug of genreSlugs) {
    for (const date of dates) {
      const chartType: "track" | "hype" = "track";
      try {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const rows = await fetchChartForDate(genreSlug, date, chartType);
        for (const row of rows) {
          let result;
          if (withArtistId && withLinkPath) {
            result = await pool.query(
              `INSERT INTO bptoptracker_daily (snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement, artist_beatport_id, artist_link_path)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (snapshot_date, genre_slug, position) DO UPDATE SET
                 artist_beatport_id = COALESCE(EXCLUDED.artist_beatport_id, bptoptracker_daily.artist_beatport_id),
                 artist_link_path = COALESCE(EXCLUDED.artist_link_path, bptoptracker_daily.artist_link_path)`,
              [
                row.snapshot_date,
                row.genre_slug,
                row.position,
                row.track_title,
                row.artist_name,
                row.artists_full,
                row.label_name,
                row.released,
                row.movement,
                row.artist_beatport_id ?? null,
                row.artist_link_path ?? null,
              ]
            );
          } else if (withArtistId) {
            result = await pool.query(
              `INSERT INTO bptoptracker_daily (snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement, artist_beatport_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (snapshot_date, genre_slug, position) DO UPDATE SET artist_beatport_id = COALESCE(EXCLUDED.artist_beatport_id, bptoptracker_daily.artist_beatport_id)`,
              [
                row.snapshot_date,
                row.genre_slug,
                row.position,
                row.track_title,
                row.artist_name,
                row.artists_full,
                row.label_name,
                row.released,
                row.movement,
                row.artist_beatport_id ?? null,
              ]
            );
          } else {
            result = await pool.query(
              `INSERT INTO bptoptracker_daily (snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (snapshot_date, genre_slug, position) DO NOTHING`,
              [
                row.snapshot_date,
                row.genre_slug,
                row.position,
                row.track_title,
                row.artist_name,
                row.artists_full,
                row.label_name,
                row.released,
                row.movement,
              ]
            );
          }
          if ((result.rowCount ?? 0) > 0) inserted++;
          else skipped++;
        }
      } catch (e) {
        errors.push(`${genreSlug} ${chartType} ${date}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { genres: genreSlugs, dates, inserted, skipped, errors };
}
