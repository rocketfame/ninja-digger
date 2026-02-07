/**
 * POST /api/internal/bptoptracker/import-paste
 * Body: { genreSlug: string, date: string (YYYY-MM-DD), tsvText: string }
 * Parses copy-paste TSV from bptoptracker chart and inserts into bptoptracker_daily.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { parseChartTsv } from "@/lib/bptoptrackerFetch";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const genreSlug = typeof body?.genreSlug === "string" ? body.genreSlug.trim() : "";
    const date = typeof body?.date === "string" ? body.date.trim() : "";
    const tsvText = typeof body?.tsvText === "string" ? body.tsvText : "";

    if (!genreSlug || !date || !tsvText) {
      return NextResponse.json(
        { error: "genreSlug, date (YYYY-MM-DD), and tsvText are required." },
        { status: 400 }
      );
    }

    const rows = parseChartTsv(tsvText, genreSlug, date);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows parsed. Paste the full table from the chart (tab-separated)." },
        { status: 400 }
      );
    }

    let inserted = 0;
    let skipped = 0;
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

    return NextResponse.json({
      ok: true,
      genreSlug,
      date,
      parsed: rows.length,
      inserted,
      skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
