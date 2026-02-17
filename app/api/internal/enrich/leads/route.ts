/**
 * POST /api/internal/enrich/leads?segment=...&genre=...&dateFrom=...&dateTo=...&force=1
 * Run enrichment for artists matching the current leads filter (same as /leads page).
 * By default skips artists who already have at least one link or contact; use force=1 to re-run.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

/** 2 in parallel ≈ 52s per request (under 60s). Same as segment. */
const PARALLEL_ARTISTS = 2;
const MAX_ARTISTS_PER_RUN = PARALLEL_ARTISTS;
const SEGMENTS_V2 = ["NEWCOMER", "NEW_ENTRY", "CONSISTENT", "FAST_GROWING", "DECLINING", "TOP_PERFORMER"] as const;

function parseDateParam(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

const WHERE_NOT_ENRICHED = `
  AND NOT EXISTS (SELECT 1 FROM artist_links al WHERE al.artist_beatport_id = ls.artist_beatport_id)
  AND NOT EXISTS (SELECT 1 FROM artist_contacts ac WHERE ac.artist_beatport_id = ls.artist_beatport_id)
`;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const segmentParam = searchParams.get("segment");
  const segment =
    segmentParam && SEGMENTS_V2.includes(segmentParam as (typeof SEGMENTS_V2)[number]) ? segmentParam : null;
  const genreParam = typeof searchParams.get("genre") === "string" ? searchParams.get("genre")!.trim() : null;
  const dateFromParam = parseDateParam(searchParams.get("dateFrom"));
  const dateToParam = parseDateParam(searchParams.get("dateTo"));
  const force = searchParams.get("force") === "1" || searchParams.get("force") === "true";

  const blocklist = getBlocklistValuesForSql();
  const blocklistCondition = `(array_length($2::text[], 1) IS NULL OR (
    am.artist_name IS NULL OR (
      NOT (LOWER(TRIM(am.artist_name)) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(REGEXP_REPLACE(am.artist_name, '\\s*[→↗⟶➔›].*$', '', 'gi'))) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(am.artist_name)) LIKE 'about us%')
      AND NOT (am.artist_name ~ '^\\d+\\s*\\/\\s*')
    )
  ))`;
  const genreConditionSeg = genreParam
    ? ` AND ((am.genres IS NOT NULL AND ($3 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE LOWER(REPLACE(TRIM(g::text), ' ', '-')) = LOWER(REPLACE(TRIM($3::text), ' ', '-'))))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $3 OR cc.genre_slug = LOWER(REPLACE(TRIM($3::text), ' ', '-')))))`
    : ` AND $3::text IS NULL`;
  const genreConditionAll =
    ` AND ($2::text IS NULL OR ((am.genres IS NOT NULL AND ($2 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE LOWER(REPLACE(TRIM(g::text), ' ', '-')) = LOWER(REPLACE(TRIM($2::text), ' ', '-'))))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $2 OR cc.genre_slug = LOWER(REPLACE(TRIM($2::text), ' ', '-'))))))`;
  const dateConditionSeg =
    " AND (($4::date IS NULL AND $5::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $4::date AND ce.snapshot_date <= $5::date))";
  const dateConditionAll =
    " AND (($3::date IS NULL AND $4::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $3::date AND ce.snapshot_date <= $4::date))";

  let runId: string | null = null;
  try {
    let artists: { artist_beatport_id: string; artist_name: string | null }[];
    let remaining: number;

    if (segment) {
      const params: (string | string[] | null)[] = [
        segment,
        blocklist,
        genreParam ?? null,
        dateFromParam ?? null,
        dateToParam ?? null,
      ];
      artists = await query<{ artist_beatport_id: string; artist_name: string | null }>(
        `SELECT DISTINCT ON (ls.artist_beatport_id) ls.artist_beatport_id, am.artist_name
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1 AND ${blocklistCondition}${genreConditionSeg}${dateConditionSeg}
         ${force ? "" : WHERE_NOT_ENRICHED}
         ORDER BY ls.artist_beatport_id
         LIMIT ${MAX_ARTISTS_PER_RUN}`,
        params
      );
      const [remRow] = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ls.artist_beatport_id)::text AS count
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1 AND ${blocklistCondition}${genreConditionSeg}${dateConditionSeg}
         ${force ? "" : WHERE_NOT_ENRICHED}`,
        params
      );
      remaining = parseInt(remRow?.count ?? "0", 10);
    } else {
      const params: (string | string[] | null)[] = [
        blocklist,
        genreParam ?? null,
        dateFromParam ?? null,
        dateToParam ?? null,
      ];
      artists = await query<{ artist_beatport_id: string; artist_name: string | null }>(
        `SELECT DISTINCT ON (ls.artist_beatport_id) ls.artist_beatport_id, am.artist_name
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ${blocklistCondition.replace(/\$2/g, "$1")}${genreConditionAll}${dateConditionAll}
         ${force ? "" : WHERE_NOT_ENRICHED}
         ORDER BY ls.artist_beatport_id
         LIMIT ${MAX_ARTISTS_PER_RUN}`,
        params
      );
      const [remRow] = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ls.artist_beatport_id)::text AS count
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ${blocklistCondition.replace(/\$2/g, "$1")}${genreConditionAll}${dateConditionAll}
         ${force ? "" : WHERE_NOT_ENRICHED}`,
        params
      );
      remaining = parseInt(remRow?.count ?? "0", 10);
    }

    if (artists.length === 0) {
      return NextResponse.json({
        ok: true,
        runId: null,
        message: force ? "No artists in filter" : "No artists left without data (all enriched or filter empty)",
        processed: 0,
        remaining,
      });
    }

    runId = (
      await pool.query<{ id: string }>(
        `INSERT INTO enrichment_runs (scope, scope_id, status, started_at) VALUES ('leads', $1, 'running', now()) RETURNING id`,
        [segment ?? "all"]
      )
    ).rows[0]?.id ?? null;

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

    let remainingAfter: number;
    if (segment) {
      const params: (string | string[] | null)[] = [
        segment,
        blocklist,
        genreParam ?? null,
        dateFromParam ?? null,
        dateToParam ?? null,
      ];
      const [remAfterRow] = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ls.artist_beatport_id)::text AS count
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1 AND ${blocklistCondition}${genreConditionSeg}${dateConditionSeg}
         ${force ? "" : WHERE_NOT_ENRICHED}`,
        params
      );
      remainingAfter = parseInt(remAfterRow?.count ?? "0", 10);
    } else {
      const params: (string | string[] | null)[] = [
        blocklist,
        genreParam ?? null,
        dateFromParam ?? null,
        dateToParam ?? null,
      ];
      const [remAfterRow] = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ls.artist_beatport_id)::text AS count
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ${blocklistCondition.replace(/\$2/g, "$1")}${genreConditionAll}${dateConditionAll}
         ${force ? "" : WHERE_NOT_ENRICHED}`,
        params
      );
      remainingAfter = parseInt(remAfterRow?.count ?? "0", 10);
    }

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
