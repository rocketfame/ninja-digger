/**
 * POST /api/internal/bptoptracker/backfill
 * Body: { genreSlug: string, dateFrom: string (YYYY-MM-DD), dateTo: string (YYYY-MM-DD) }
 * Fetches BP Top Tracker chart for each day in range and inserts into bptoptracker_daily.
 * Uses BPTOPTRACKER_EMAIL + BPTOPTRACKER_PASSWORD or BPTOPTRACKER_COOKIE from env.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { fetchChartForDate, dateRange } from "@/lib/bptoptrackerFetch";

const DELAY_MS = 1500;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const genreSlug = typeof body?.genreSlug === "string" ? body.genreSlug.trim() : "";
    const dateFrom = typeof body?.dateFrom === "string" ? body.dateFrom.trim() : "";
    const dateTo = typeof body?.dateTo === "string" ? body.dateTo.trim() : "";

    if (!genreSlug || !dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "genreSlug, dateFrom, dateTo are required (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const dates = dateRange(dateFrom, dateTo);
    if (dates.length > 120) {
      return NextResponse.json(
        { error: "Max 120 days per run. Use a shorter range." },
        { status: 400 }
      );
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
      try {
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
          if ((result.rowCount ?? 0) > 0) totalInserted++;
          else totalSkipped++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${date}: ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      genreSlug,
      datesRequested: dates.length,
      totalInserted,
      totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
