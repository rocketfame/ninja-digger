/**
 * POST /api/internal/enrich/artist?artistId=...&rescan=1
 * Run enrichment for one artist; record run in enrichment_runs.
 * If rescan=1: delete all flagged links/contacts and clear related URL cache
 * before re-running, so the algorithm tries different search paths.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

/** Vercel Pro: дозволяємо до 60с для enrichment одного артиста */
export const maxDuration = 60;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artistId");
  const isRescan = searchParams.get("rescan") === "1";
  if (!artistId) {
    return NextResponse.json({ error: "artistId required" }, { status: 400 });
  }

  let runId: string | null = null;
  try {
    if (isRescan) {
      const flaggedLinks = await pool.query<{ url: string }>(
        `SELECT url FROM artist_links WHERE artist_beatport_id = $1 AND status = 'flagged'`,
        [artistId]
      );
      const flaggedContacts = await pool.query<{ source_url: string | null }>(
        `SELECT source_url FROM artist_contacts WHERE artist_beatport_id = $1 AND status = 'flagged'`,
        [artistId]
      );

      const urlsToInvalidate = new Set<string>();
      for (const r of flaggedLinks.rows) if (r.url) urlsToInvalidate.add(r.url);
      for (const r of flaggedContacts.rows) if (r.source_url) urlsToInvalidate.add(r.source_url);

      await pool.query(
        `DELETE FROM artist_links WHERE artist_beatport_id = $1 AND status = 'flagged'`,
        [artistId]
      );
      await pool.query(
        `DELETE FROM artist_contacts WHERE artist_beatport_id = $1 AND status = 'flagged'`,
        [artistId]
      );

      if (urlsToInvalidate.size > 0) {
        const urls = [...urlsToInvalidate];
        await pool.query(
          `DELETE FROM url_cache WHERE url = ANY($1::text[])`,
          [urls]
        );
      }
    }

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
      rescan: isRescan,
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
