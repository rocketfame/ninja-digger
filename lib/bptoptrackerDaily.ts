/**
 * Daily update: fetch today (and yesterday) for BPTOPTRACKER_GENRES and insert into bptoptracker_daily.
 */

import { pool } from "@/lib/db";
import { fetchChartForDate } from "./bptoptrackerFetch";

const DELAY_MS = 1500;

export async function runBptoptrackerDailyUpdate(): Promise<{
  genres: string[];
  dates: string[];
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const genresStr = process.env.BPTOPTRACKER_GENRES?.trim();
  const genres = genresStr ? genresStr.split(",").map((g) => g.trim()).filter(Boolean) : [];
  if (genres.length === 0) {
    return { genres: [], dates: [], inserted: 0, skipped: 0, errors: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
  const dates = [yesterday, today];

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const genreSlug of genres) {
    for (const date of dates) {
      try {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const rows = await fetchChartForDate(genreSlug, date);
        for (const row of rows) {
          const result = await pool.query(
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
          if ((result.rowCount ?? 0) > 0) inserted++;
          else skipped++;
        }
      } catch (e) {
        errors.push(`${genreSlug} ${date}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { genres, dates, inserted, skipped, errors };
}
