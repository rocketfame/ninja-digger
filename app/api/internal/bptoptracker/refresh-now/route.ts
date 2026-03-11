/**
 * POST /api/internal/bptoptracker/refresh-now
 * Manual "Оновити дані з BP Top Tracker": determine last date in DB, fetch missing days (last+1 .. today),
 * then sync to chart_entries + normalize + score. No throttle.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getBptoptrackerCookie, clearBptoptrackerCookieCache, getLastLoginError } from "@/lib/bptoptrackerAuth";
import { runBptoptrackerForDateRange } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

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

export async function POST() {
  try {
    const { getBptoptrackerGenresForSync } = await import("@/lib/bptoptrackerGenres");
    const envGenres = getBptoptrackerGenresForSync();

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);

    const rows = await query<{ max_date: string | null }>(
      `SELECT MAX(ce.snapshot_date)::text AS max_date
       FROM chart_entries ce
       JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'`
    );
    let lastInDb = rows[0]?.max_date ?? null;
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
      if (from > today) {
        return NextResponse.json({
          ok: true,
          lastDateInDb: lastInDb,
          fetchedDates: [],
          message: "Дані вже актуальні до сьогодні.",
          chartEntriesInserted: 0,
          metricsUpdated: 0,
          scoresUpdated: 0,
        });
      }
      datesToFetch = dateRange(from, today);
    }

    clearBptoptrackerCookieCache();
    const cookie = await getBptoptrackerCookie();
    if (!cookie) {
      const reason = getLastLoginError();
      return NextResponse.json({
        ok: false,
        error: reason
          ? `Не вдалося залогінитись. ${reason}`
          : "Перевір BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env.",
      }, { status: 401 });
    }

    const bpt = await runBptoptrackerForDateRange(envGenres, datesToFetch);
    const sync = await syncBptoptrackerToChartEntries();
    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();

    const newLastRows = await query<{ max_date: string | null }>(
      `SELECT MAX(ce.snapshot_date)::text AS max_date
       FROM chart_entries ce
       JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'`
    );
    const newLastInDb = newLastRows[0]?.max_date ?? lastInDb;

    return NextResponse.json({
      ok: true,
      lastDateInDb: newLastInDb,
      fetchedDates: datesToFetch,
      bptoptracker: { inserted: bpt.inserted, skipped: bpt.skipped, errors: bpt.errors },
      chartEntriesInserted: sync.chartEntriesInserted,
      artistsMatched: sync.artistsMatched,
      metricsUpdated,
      scoresUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[refresh-now]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
