/**
 * POST /api/internal/enrich/leads?segment=...&genre=...&dateFrom=...&dateTo=...&force=1
 * Run enrichment for artists matching the current leads filter (same as /leads page).
 * By default skips artists who already have at least one link or contact; use force=1 to re-run.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

/** Vercel: дозволяємо до 120с для batch enrichment */
export const maxDuration = 120;

/** 3 in parallel ≈ 55s per request. Fits safely within 60s. */
const PARALLEL_ARTISTS = 3;
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
  const countOnly = searchParams.get("countOnly") === "1";

  const blocklist = getBlocklistValuesForSql();
  const blocklistCondition = `(array_length($2::text[], 1) IS NULL OR (
    am.artist_name IS NULL OR (
      NOT (LOWER(TRIM(am.artist_name)) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(REGEXP_REPLACE(am.artist_name, '\\s*[→↗⟶➔›].*$', '', 'gi'))) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(am.artist_name)) LIKE 'about us%')
      AND NOT (am.artist_name ~ '^\\d+\\s*\\/\\s*')
    )
  ))`;
  const toSlug = (ref: string) =>
    `LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(${ref}), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'))`;
  const genreConditionSeg = genreParam
    ? ` AND ((am.genres IS NOT NULL AND ($3 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE ${toSlug("g::text")} = ${toSlug("$3::text")}))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $3 OR cc.genre_slug = ${toSlug("$3::text")})))`
    : ` AND $3::text IS NULL`;
  const genreConditionAll =
    ` AND ($2::text IS NULL OR ((am.genres IS NOT NULL AND ($2 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE ${toSlug("g::text")} = ${toSlug("$2::text")}))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $2 OR cc.genre_slug = ${toSlug("$2::text")}))))`;
  const useFirstSeen = segment === "NEWCOMER" || segment === "NEW_ENTRY";
  const dateConditionSeg = useFirstSeen
    ? " AND (($4::date IS NULL AND $5::date IS NULL) OR (am.first_seen IS NOT NULL AND am.first_seen >= $4::date AND am.first_seen <= $5::date))"
    : " AND (($4::date IS NULL AND $5::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $4::date AND ce.snapshot_date <= $5::date))";
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

    // Preflight: return the queue size instantly so the UI can show scale/ETA
    if (countOnly) {
      return NextResponse.json({ ok: true, processed: 0, remaining });
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
    const results = await Promise.allSettled(
      artists.map(({ artist_beatport_id }) => runEnrichmentForArtist(artist_beatport_id))
    );
    for (const settled of results) {
      if (settled.status === "rejected") {
        lastError = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        continue;
      }
      const result = settled.value;
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

/**
 * GET handler for Vercel Cron — batch-enriches NEWCOMER artists.
 * Loops through multiple batches until time runs out.
 * Each batch ≈ 50-60s (2 artists in parallel). We track elapsed time per batch
 * and only start a new batch if there's enough time remaining.
 */
export async function GET() {
  const HARD_LIMIT_MS = 115_000; // absolute max before Vercel kills us (120s maxDuration)
  const cronStart = Date.now();
  let totalProcessed = 0;
  let totalLinks = 0;
  let totalContacts = 0;
  let lastError: string | null = null;
  let batchCount = 0;
  let avgBatchMs = 60_000; // initial estimate: 60s per batch

  const blocklist = getBlocklistValuesForSql();
  const blocklistCondition = `(array_length($2::text[], 1) IS NULL OR (
    am.artist_name IS NULL OR (
      NOT (LOWER(TRIM(am.artist_name)) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(REGEXP_REPLACE(am.artist_name, '\\s*[→↗⟶➔›].*$', '', 'gi'))) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(am.artist_name)) LIKE 'about us%')
      AND NOT (am.artist_name ~ '^\\d+\\s*\\/\\s*')
    )
  ))`;

  try {
    while (true) {
      const elapsed = Date.now() - cronStart;
      const timeRemaining = HARD_LIMIT_MS - elapsed;
      // Only start new batch if we have enough time (avg batch duration + 10s safety)
      if (timeRemaining < avgBatchMs + 10_000) {
        console.log(`[enrich-cron] Stopping: ${Math.round(timeRemaining / 1000)}s remaining, need ~${Math.round(avgBatchMs / 1000)}s for next batch`);
        break;
      }
      // Fetch next batch of un-enriched artists: hottest segments first, freshest first
      let artists: { artist_beatport_id: string; artist_name: string | null }[] = [];
      for (const seg of ["NEWCOMER", "NEW_ENTRY", "FAST_GROWING"]) {
        artists = await query<{ artist_beatport_id: string; artist_name: string | null }>(
          `SELECT t.artist_beatport_id, t.artist_name FROM (
             SELECT DISTINCT ON (ls.artist_beatport_id) ls.artist_beatport_id, am.artist_name, am.first_seen
             FROM lead_scores ls
             LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
             WHERE ls.segment = $1 AND ${blocklistCondition}
             ${WHERE_NOT_ENRICHED}
             ORDER BY ls.artist_beatport_id
           ) t
           ORDER BY t.first_seen DESC NULLS LAST
           LIMIT ${PARALLEL_ARTISTS}`,
          [seg, blocklist]
        );
        if (artists.length > 0) break;
      }

      if (artists.length === 0) break; // all enriched

      batchCount++;
      const batchStart = Date.now();
      console.log(`[enrich-cron] Batch ${batchCount}: processing ${artists.length} artists (${Math.round((Date.now() - cronStart) / 1000)}s elapsed)`);

      // Process batch — each artist independently so one failure doesn't kill others
      const results = await Promise.allSettled(
        artists.map(({ artist_beatport_id }) => runEnrichmentForArtist(artist_beatport_id))
      );

      const batchDuration = Date.now() - batchStart;
      // Update rolling average for smarter time estimation
      avgBatchMs = batchCount === 1 ? batchDuration : Math.round((avgBatchMs + batchDuration) / 2);

      for (const result of results) {
        if (result.status === "fulfilled") {
          totalProcessed++;
          totalLinks += result.value.linksAdded;
          totalContacts += result.value.contactsAdded;
          if (result.value.error) lastError = result.value.error;
        } else {
          totalProcessed++;
          lastError = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error(`[enrich-cron] Artist failed:`, lastError);
        }
      }

      console.log(`[enrich-cron] Batch ${batchCount} done in ${Math.round(batchDuration / 1000)}s: +${results.length} artists, total ${totalLinks} links, ${totalContacts} contacts`);
    }

    // Count remaining
    const [remRow] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT ls.artist_beatport_id)::text AS count
       FROM lead_scores ls
       LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
       WHERE ls.segment = $1 AND ${blocklistCondition}
       ${WHERE_NOT_ENRICHED}`,
      ["NEWCOMER", blocklist]
    );
    const remaining = parseInt(remRow?.count ?? "0", 10);

    console.log(`[enrich-cron] Done: ${totalProcessed} processed in ${batchCount} batches, ${remaining} remaining, ${Math.round((Date.now() - cronStart) / 1000)}s total`);

    // Log run
    await pool.query(
      `INSERT INTO enrichment_runs (scope, scope_id, status, started_at, finished_at, error)
       VALUES ('leads', 'NEWCOMER-cron', 'completed', to_timestamp($1), now(), $2)`,
      [Math.floor(cronStart / 1000), lastError]
    ).catch(() => {}); // don't fail on logging

    return NextResponse.json({
      ok: true,
      source: "cron",
      batches: batchCount,
      processed: totalProcessed,
      linksAdded: totalLinks,
      contactsAdded: totalContacts,
      remaining,
      elapsed: `${Math.round((Date.now() - cronStart) / 1000)}s`,
      error: lastError ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[enrich-cron] Fatal error:`, message);

    await pool.query(
      `INSERT INTO enrichment_runs (scope, scope_id, status, started_at, finished_at, error)
       VALUES ('leads', 'NEWCOMER-cron', 'failed', to_timestamp($1), now(), $2)`,
      [Math.floor(cronStart / 1000), message]
    ).catch(() => {});

    return NextResponse.json({ ok: false, error: message, processed: totalProcessed }, { status: 500 });
  }
}
