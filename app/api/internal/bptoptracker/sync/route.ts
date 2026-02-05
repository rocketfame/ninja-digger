/**
 * POST /api/internal/bptoptracker/sync
 * Sync bptoptracker_daily → chart_entries (for matched artists), then normalize + score.
 * After this, main Leads table will include artists from retro data (matched by name or manual link).
 */

import { NextResponse } from "next/server";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

export async function POST() {
  try {
    const sync = await syncBptoptrackerToChartEntries();
    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();

    return NextResponse.json({
      ok: true,
      chartEntriesInserted: sync.chartEntriesInserted,
      artistsMatched: sync.artistsMatched,
      metricsUpdated,
      scoresUpdated,
      errors: sync.errors.length > 0 ? sync.errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
