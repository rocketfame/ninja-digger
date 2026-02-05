/**
 * POST /api/internal/enrich/artist?artistId=...
 * Run enrichment for one artist; record run in enrichment_runs.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artistId");
  if (!artistId) {
    return NextResponse.json({ error: "artistId required" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    const run = await pool.query<{ id: string }>(
      `INSERT INTO enrichment_runs (scope, scope_id, status, started_at) VALUES ('artist', $1, 'running', now()) RETURNING id`,
      [artistId]
    );
    runId = run.rows[0]?.id ?? null;

    const result = await runEnrichmentForArtist(artistId);

    if (runId) {
      await pool.query(
        `UPDATE enrichment_runs SET status = $1, finished_at = now(), error = $2 WHERE id = $3`,
        [result.error ? "failed" : "completed", result.error ?? null, runId]
      );
    }

    return NextResponse.json({
      ok: !result.error,
      runId,
      linksAdded: result.linksAdded,
      contactsAdded: result.contactsAdded,
      error: result.error,
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
