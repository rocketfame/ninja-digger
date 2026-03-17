/**
 * GET /api/internal/bptoptracker/db-stats
 * Returns diagnostic DB stats: row counts, date coverage, genre coverage, segment distribution.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const [
      dailyStats,
      chartEntryStats,
      metricsStats,
      scoreStats,
      segmentDist,
      recentDailyByGenre,
      recentNewArtists,
      genreCoverage,
    ] = await Promise.all([
      // bptoptracker_daily totals
      query<{ total: number; min_date: string | null; max_date: string | null; genre_count: number }>(
        `SELECT COUNT(*)::int AS total,
                MIN(snapshot_date)::text AS min_date,
                MAX(snapshot_date)::text AS max_date,
                COUNT(DISTINCT genre_slug)::int AS genre_count
         FROM bptoptracker_daily`
      ),
      // chart_entries totals
      query<{ total: number; min_date: string | null; max_date: string | null; distinct_artists: number }>(
        `SELECT COUNT(*)::int AS total,
                MIN(snapshot_date)::text AS min_date,
                MAX(snapshot_date)::text AS max_date,
                COUNT(DISTINCT artist_beatport_id)::int AS distinct_artists
         FROM chart_entries ce
         JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'`
      ),
      // artist_metrics totals
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM artist_metrics`
      ),
      // lead_scores totals
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM lead_scores`
      ),
      // segment distribution
      query<{ segment: string; cnt: number }>(
        `SELECT segment, COUNT(*)::int AS cnt FROM lead_scores GROUP BY segment ORDER BY cnt DESC`
      ),
      // recent bptoptracker_daily by date (last 7 days)
      query<{ snapshot_date: string; row_count: number; genre_count: number }>(
        `SELECT snapshot_date::text, COUNT(*)::int AS row_count, COUNT(DISTINCT genre_slug)::int AS genre_count
         FROM bptoptracker_daily
         WHERE snapshot_date >= CURRENT_DATE - 7
         GROUP BY snapshot_date ORDER BY snapshot_date DESC`
      ),
      // new artists in last 7 days (first_seen)
      query<{ first_seen: string; cnt: number }>(
        `SELECT first_seen::text, COUNT(*)::int AS cnt
         FROM artist_metrics
         WHERE first_seen >= CURRENT_DATE - 7
         GROUP BY first_seen ORDER BY first_seen DESC`
      ),
      // genre coverage for latest date in bptoptracker_daily
      query<{ genre_slug: string; row_count: number }>(
        `SELECT genre_slug, COUNT(*)::int AS row_count
         FROM bptoptracker_daily
         WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM bptoptracker_daily)
         GROUP BY genre_slug ORDER BY genre_slug`
      ),
    ]);

    return NextResponse.json({
      bptoptracker_daily: dailyStats[0],
      chart_entries: chartEntryStats[0],
      artist_metrics: metricsStats[0],
      lead_scores: scoreStats[0],
      segment_distribution: segmentDist,
      recent_daily_by_date: recentDailyByGenre,
      new_artists_last_7d: recentNewArtists,
      genre_coverage_latest_date: genreCoverage,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
