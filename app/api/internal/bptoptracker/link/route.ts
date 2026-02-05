/**
 * POST: save manual link artist_name -> artist_beatport_id.
 * GET: list existing links (optional).
 */

import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const artistName = typeof body?.artist_name === "string" ? body.artist_name.trim() : "";
    const artistBeatportId = typeof body?.artist_beatport_id === "string" ? body.artist_beatport_id.trim() : "";
    if (!artistName || !artistBeatportId) {
      return NextResponse.json(
        { error: "artist_name and artist_beatport_id required." },
        { status: 400 }
      );
    }
    await pool.query(
      `INSERT INTO bptoptracker_artist_links (artist_name, artist_beatport_id)
       VALUES ($1, $2)
       ON CONFLICT (artist_name) DO UPDATE SET artist_beatport_id = EXCLUDED.artist_beatport_id, linked_at = now()`,
      [artistName, artistBeatportId]
    );
    return NextResponse.json({ ok: true, artist_name: artistName, artist_beatport_id: artistBeatportId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
