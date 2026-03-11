/**
 * GET/POST /api/internal/bptoptracker/background-sync
 * Fill missing days (last date in chart_entries bptoptracker .. today) from BPTT, then sync + score.
 * So after reload the app pulls 7th through today if there was a gap. Throttled: at most once per minIntervalMinutes.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { runBptoptrackerForDateRange } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

const DEFAULT_INTERVAL_MINUTES = 60;
const SCOPE = "bptoptracker";

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (fromDate.getTime() > toDate.getTime()) return out;
  const cur = new Date(fromDate);
  while (cur.getTime() <= toDate.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const { searchParams } = new URL(request.url);
  const minIntervalMinutes = Math.min(
    1440,
    Math.max(5, parseInt(searchParams.get("minIntervalMinutes") ?? String(DEFAULT_INTERVAL_MINUTES), 10) || DEFAULT_INTERVAL_MINUTES)
  );

  try {
    const rows = await query<{ ran_at: Date }>(
      `SELECT ran_at FROM background_sync_runs WHERE scope = $1 ORDER BY ran_at DESC LIMIT 1`,
      [SCOPE]
    );
    const lastRun = rows[0]?.ran_at;
    if (lastRun) {
      const elapsed = (Date.now() - new Date(lastRun).getTime()) / 60000;
      if (elapsed < minIntervalMinutes) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "recent",
          nextRunInMinutes: Math.ceil(minIntervalMinutes - elapsed),
        });
      }
    }

    const { getBptoptrackerGenresForSync } = await import("@/lib/bptoptrackerGenres");
    const envGenres = getBptoptrackerGenresForSync();

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);

    const lastRows = await query<{ max_date: string | null }>(
      `SELECT MAX(ce.snapshot_date)::text AS max_date
       FROM chart_entries ce
       JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'`
    );
    let lastInDb = lastRows[0]?.max_date ?? null;
    if (lastInDb == null) {
      const dailyRows = await query<{ max_date: string | null }>(
        `SELECT MAX(snapshot_date)::text AS max_date FROM bptoptracker_daily`
      );
      lastInDb = dailyRows[0]?.max_date ?? null;
    }

    let datesToFetch: string[];
    if (!lastInDb) {
      datesToFetch = [yesterday, today];
    } else {
      const nextDay = new Date(lastInDb);
      nextDay.setDate(nextDay.getDate() + 1);
      const from = nextDay.toISOString().slice(0, 10);
      datesToFetch = from > today ? [] : dateRange(from, today);
    }

    let bpt = { genres: envGenres, dates: [] as string[], inserted: 0, skipped: 0, errors: [] as string[] };
    if (datesToFetch.length > 0) {
      bpt = await runBptoptrackerForDateRange(envGenres, datesToFetch);
    }

    const sync = await syncBptoptrackerToChartEntries();
    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();

    await pool.query(
      `INSERT INTO background_sync_runs (scope, ran_at) VALUES ($1, now())`,
      [SCOPE]
    );

    return NextResponse.json({
      ok: true,
      skipped: false,
      bptoptracker: { genres: bpt.genres, datesFetched: datesToFetch.length, inserted: bpt.inserted, skipped: bpt.skipped, errors: bpt.errors },
      chartEntriesInserted: sync.chartEntriesInserted,
      artistsMatched: sync.artistsMatched,
      metricsUpdated,
      scoresUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[background-sync]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
