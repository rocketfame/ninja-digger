/**
 * POST /api/internal/enrich/segment?segmentId=...
 * Run enrichment for all artists in segment (rate-limited; first 5 per run to stay under timeout).
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

const MAX_ARTISTS_PER_RUN = 5;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const segmentId = searchParams.get("segmentId");
  if (!segmentId) {
    return NextResponse.json({ error: "segmentId required" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    const artists = await query<{ artist_beatport_id: string }>(
      `SELECT artist_beatport_id FROM segment_artists WHERE segment_id = $1 LIMIT $2`,
      [segmentId, MAX_ARTISTS_PER_RUN]
    );
    if (artists.length === 0) {
      return NextResponse.json({
        ok: true,
        runId: null,
        message: "No artists in segment",
        processed: 0,
      });
    }

    const run = await pool.query<{ id: string }>(
      `INSERT INTO enrichment_runs (scope, scope_id, status, started_at) VALUES ('segment', $1, 'running', now()) RETURNING id`,
      [segmentId]
    );
    runId = run.rows[0]?.id ?? null;

    let linksAdded = 0;
    let contactsAdded = 0;
    let lastError: string | null = null;
    for (const { artist_beatport_id } of artists) {
      const result = await runEnrichmentForArtist(artist_beatport_id);
      linksAdded += result.linksAdded;
      contactsAdded += result.contactsAdded;
      if (result.error) lastError = result.error;
    }

    if (runId) {
      await pool.query(
        `UPDATE enrichment_runs SET status = 'completed', finished_at = now(), error = $1 WHERE id = $2`,
        [lastError, runId]
      );
    }

    return NextResponse.json({
      ok: true,
      runId,
      processed: artists.length,
      linksAdded,
      contactsAdded,
      error: lastError ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await pool.query(
        `UPDATE enrichment_runs SET status = 'failed', finished_at = now(), error = $1 WHERE id = $2`,
        [message, runId]
      );
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
