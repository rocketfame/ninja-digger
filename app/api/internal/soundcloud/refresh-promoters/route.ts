/**
 * POST /api/internal/soundcloud/refresh-promoters — backfill real profile data
 * (track_count etc.) for Re-Ex promoters ingested without it. Separates repost
 * channels (0 own tracks, analytics only) from real artists (outreach leads).
 * Loops in-request within the time budget; call repeatedly until remaining=0.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { refreshPromoterProfiles } from "@/lib/soundcloud";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const started = Date.now();
  let checked = 0, withTracks = 0;
  // Keep going until we run low on time or there's nothing left to refresh.
  while (Date.now() - started < 100_000) {
    const r = await refreshPromoterProfiles(15);
    checked += r.checked; withTracks += r.withTracks;
    if (r.checked === 0) break;
  }
  const remaining = (await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM sc_artists WHERE is_promoter = true AND profile_refreshed_at IS NULL`
  )).rows[0].c;
  const withTracksTotal = (await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM sc_artists WHERE is_promoter = true AND track_count >= 1`
  )).rows[0].c;
  return NextResponse.json({ ok: true, checkedThisRun: checked, withTracksThisRun: withTracks, remaining, promotersWithTracks: withTracksTotal });
}
