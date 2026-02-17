/**
 * POST /api/internal/enrich/segment?segmentId=...&force=1
 * Run enrichment for artists in segment. Processes PARALLEL_ARTISTS at a time (default 2)
 * so one request stays ~50s (under 60s serverless limit). One click = loop until remaining 0.
 * By default skips artists who already have at least one link or contact; use force=1 to re-run for all.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

/** 2 artists in parallel ≈ 52s per request (under 60s). 90 artists → 45 requests ≈ 39 min total. */
const PARALLEL_ARTISTS = 2;
const MAX_ARTISTS_PER_RUN = PARALLEL_ARTISTS;

/** Артисти без жодного запису в artist_links і artist_contacts вважаються «без даних». */
const WHERE_NOT_ENRICHED = `
  AND NOT EXISTS (SELECT 1 FROM artist_links al WHERE al.artist_beatport_id = sa.artist_beatport_id)
  AND NOT EXISTS (SELECT 1 FROM artist_contacts ac WHERE ac.artist_beatport_id = sa.artist_beatport_id)
`;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const segmentId = searchParams.get("segmentId");
  const force = searchParams.get("force") === "1" || searchParams.get("force") === "true";
  if (!segmentId) {
    return NextResponse.json({ error: "segmentId required" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    const artists = await query<{ artist_beatport_id: string; artist_name: string | null }>(
      `SELECT sa.artist_beatport_id, am.artist_name
       FROM segment_artists sa
       LEFT JOIN artist_metrics am ON am.artist_beatport_id = sa.artist_beatport_id
       WHERE sa.segment_id = $1
       ${force ? "" : WHERE_NOT_ENRICHED}
       ORDER BY sa.artist_beatport_id
       LIMIT $2`,
      [segmentId, MAX_ARTISTS_PER_RUN]
    );
    const [remainingRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM segment_artists sa
       WHERE sa.segment_id = $1 ${force ? "" : WHERE_NOT_ENRICHED}`,
      [segmentId]
    );
    const remaining = parseInt(remainingRow?.count ?? "0", 10);

    if (artists.length === 0) {
      return NextResponse.json({
        ok: true,
        runId: null,
        message: force ? "No artists in segment" : "No artists left without data (all enriched or segment empty)",
        processed: 0,
        remaining,
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
    const results = await Promise.all(
      artists.map(({ artist_beatport_id }) => runEnrichmentForArtist(artist_beatport_id))
    );
    for (const result of results) {
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

    const [remainingAfterRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM segment_artists sa
       WHERE sa.segment_id = $1 ${force ? "" : WHERE_NOT_ENRICHED}`,
      [segmentId]
    );
    const remainingAfter = parseInt(remainingAfterRow?.count ?? "0", 10);

    return NextResponse.json({
      ok: true,
      runId,
      processed: artists.length,
      linksAdded,
      contactsAdded,
      remaining: remainingAfter,
      artists: artists.map((a) => ({ artist_beatport_id: a.artist_beatport_id, artist_name: a.artist_name ?? null })),
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
