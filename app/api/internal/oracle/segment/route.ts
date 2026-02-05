/**
 * Oracle Mode: save segment + items to DB.
 * POST body: { segmentName: string, notes?: string, source_url?: string, items: OracleScanItem[] }
 * Creates segment (source_type=oracle) + segment_items; also segment_artists for linking.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

type ItemInput = {
  artist_beatport_id?: string;
  artist_name: string;
  artist_url?: string;
  track_name?: string;
  track_url?: string;
  rank?: number;
  raw_json?: Record<string, unknown>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const segmentName = typeof body?.segmentName === "string" ? body.segmentName.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
    const sourceUrl = typeof body?.source_url === "string" ? body.source_url.trim() || null : null;
    const items = Array.isArray(body?.items) ? (body.items as ItemInput[]) : [];

    if (!segmentName) {
      return NextResponse.json(
        { ok: false, error: "Segment name is required." },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      const seg = await client.query<{ id: string }>(
        `INSERT INTO segments (name, source_type, source_url, notes) VALUES ($1, 'oracle', $2, $3) RETURNING id`,
        [segmentName, sourceUrl, notes]
      );
      const segmentId = seg.rows[0]?.id;
      if (!segmentId) {
        return NextResponse.json(
          { ok: false, error: "Failed to create segment." },
          { status: 500 }
        );
      }

      let itemsAdded = 0;
      const artistIds = new Set<string>();

      for (const it of items) {
        const artistName = typeof it.artist_name === "string" ? it.artist_name : "Unknown";
        const artistBeatportId = typeof it.artist_beatport_id === "string" ? it.artist_beatport_id || null : null;
        const artistUrl = typeof it.artist_url === "string" ? it.artist_url || null : null;
        const trackName = typeof it.track_name === "string" ? it.track_name || null : null;
        const trackUrl = typeof it.track_url === "string" ? it.track_url || null : null;
        const rank = typeof it.rank === "number" && Number.isFinite(it.rank) ? it.rank : null;
        const rawJson = it.raw_json != null && typeof it.raw_json === "object" ? JSON.stringify(it.raw_json) : null;

        await client.query(
          `INSERT INTO segment_items (segment_id, artist_beatport_id, artist_name, artist_url, track_name, track_url, rank, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [segmentId, artistBeatportId, artistName, artistUrl, trackName, trackUrl, rank, rawJson]
        );
        itemsAdded++;
        if (artistBeatportId) artistIds.add(artistBeatportId);
      }

      for (const aid of artistIds) {
        await client.query(
          `INSERT INTO segment_artists (segment_id, artist_beatport_id) VALUES ($1, $2)
           ON CONFLICT (segment_id, artist_beatport_id) DO NOTHING`,
          [segmentId, aid]
        );
      }

      return NextResponse.json({
        ok: true,
        segmentId,
        name: segmentName,
        itemsAdded,
        artistsLinked: artistIds.size,
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
