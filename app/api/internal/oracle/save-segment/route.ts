/**
 * Oracle Mode: save scan result as a named segment (without adding to main pipeline).
 * POST body: { name: string, source_url: string, artist_beatport_ids: string[] }
 * Creates segment (source_type=oracle) and segment_artists rows.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const sourceUrl = typeof body?.source_url === "string" ? body.source_url.trim() : null;
    const ids = Array.isArray(body?.artist_beatport_ids)
      ? (body.artist_beatport_ids as unknown[])
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Segment name is required." },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      const seg = await client.query<{ id: string }>(
        `INSERT INTO segments (name, source_type, source_url) VALUES ($1, 'oracle', $2) RETURNING id`,
        [name, sourceUrl]
      );
      const segmentId = seg.rows[0]?.id;
      if (!segmentId) {
        return NextResponse.json(
          { ok: false, error: "Failed to create segment." },
          { status: 500 }
        );
      }
      let added = 0;
      for (const artistBeatportId of ids) {
        const r = await client.query(
          `INSERT INTO segment_artists (segment_id, artist_beatport_id) VALUES ($1, $2)
           ON CONFLICT (segment_id, artist_beatport_id) DO NOTHING`,
          [segmentId, artistBeatportId]
        );
        if ((r.rowCount ?? 0) > 0) added++;
      }
      return NextResponse.json({
        ok: true,
        segmentId,
        name,
        artistsAdded: added,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
