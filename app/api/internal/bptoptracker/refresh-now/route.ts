/**
 * POST /api/internal/bptoptracker/refresh-now
 * Manual "Оновити дані з BP Top Tracker": determine last date in DB, fetch missing days (last+1 .. today),
 * then sync to chart_entries + normalize + score.
 * For gaps > 3 days: uses parallel backfill mode to fit within Vercel 300s timeout.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { getBptoptrackerCookie, clearBptoptrackerCookieCache, getLastLoginError } from "@/lib/bptoptrackerAuth";
import { runBptoptrackerForDateRange } from "@/lib/bptoptrackerDaily";
import { fetchChartForDate, dateRange as genDateRange, type BptoptrackerDailyRow } from "@/lib/bptoptrackerFetch";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

export const maxDuration = 300; // 5 min for Vercel

const PARALLEL_CONCURRENCY = 3;
const PARALLEL_BATCH_DELAY_MS = 1000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 3000;

/** Parallel backfill for large gaps (>3 days). Faster than sequential. */
async function parallelFetchAndStore(
  genres: string[],
  dates: string[]
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const tasks: { genre: string; date: string }[] = [];
  for (const genre of genres) for (const date of dates) tasks.push({ genre, date });

  const errors: string[] = [];
  const allRows: BptoptrackerDailyRow[] = [];

  for (let i = 0; i < tasks.length; i += PARALLEL_CONCURRENCY) {
    if (i > 0) await new Promise(r => setTimeout(r, PARALLEL_BATCH_DELAY_MS));
    const chunk = tasks.slice(i, i + PARALLEL_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (t) => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return { rows: await fetchChartForDate(t.genre, t.date, "track"), error: null };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("логіну") || msg.includes("login") || msg.includes("HTTP 404")) {
              return { rows: [] as BptoptrackerDailyRow[], error: `${t.genre}/${t.date}: ${msg}` };
            }
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
            else return { rows: [] as BptoptrackerDailyRow[], error: `${t.genre}/${t.date}: ${msg}` };
          }
        }
        return { rows: [] as BptoptrackerDailyRow[], error: null };
      })
    );
    for (const r of results) {
      if (r.error) errors.push(r.error);
      if (r.rows.length) allRows.push(...r.rows);
    }
  }

  // Batch insert into bptoptracker_daily
  let inserted = 0;
  let skipped = 0;
  const BATCH = 150;
  for (let j = 0; j < allRows.length; j += BATCH) {
    const batch = allRows.slice(j, j + BATCH);
    const values: (string | number | null)[] = [];
    const phs: string[] = [];
    let p = 1;
    for (const row of batch) {
      phs.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10})`);
      values.push(row.snapshot_date, row.genre_slug, row.position, row.track_title, row.artist_name, row.artists_full, row.label_name, row.released, row.movement, row.artist_beatport_id ?? null, row.artist_link_path ?? null);
      p += 11;
    }
    const res = await pool.query(
      `INSERT INTO bptoptracker_daily (snapshot_date,genre_slug,position,track_title,artist_name,artists_full,label_name,released,movement,artist_beatport_id,artist_link_path)
       VALUES ${phs.join(",")}
       ON CONFLICT (snapshot_date,genre_slug,position) DO UPDATE SET
         artist_beatport_id=COALESCE(EXCLUDED.artist_beatport_id,bptoptracker_daily.artist_beatport_id),
         artist_link_path=COALESCE(EXCLUDED.artist_link_path,bptoptracker_daily.artist_link_path)`,
      values
    );
    inserted += res.rowCount ?? 0;
    skipped += batch.length - (res.rowCount ?? 0);
  }
  return { inserted, skipped, errors };
}

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

    // Check genre coverage for recent dates (today + yesterday)
    const recentDates = [yesterday, today];
    const coverageRows = await query<{ snapshot_date: string; genre_count: number }>(
      `SELECT snapshot_date::text, COUNT(DISTINCT genre_slug)::int AS genre_count
       FROM bptoptracker_daily
       WHERE snapshot_date = ANY($1::date[])
       GROUP BY snapshot_date`,
      [recentDates]
    );
    const coverageMap = new Map(coverageRows.map(r => [r.snapshot_date, r.genre_count]));
    const expectedGenres = envGenres.length;
    const missingCoverage = recentDates.filter(d => (coverageMap.get(d) ?? 0) < expectedGenres * 0.8); // <80% coverage

    let datesToFetch: string[];
    if (!lastInDb) {
      datesToFetch = [yesterday, today];
    } else {
      const nextDay = new Date(lastInDb);
      nextDay.setDate(nextDay.getDate() + 1);
      const from = nextDay.toISOString().slice(0, 10);
      if (from > today && missingCoverage.length === 0) {
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
      // Include dates with missing genre coverage
      const newDates = from <= today ? dateRange(from, today) : [];
      datesToFetch = [...new Set([...newDates, ...missingCoverage])].sort();
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

    // For large gaps (>3 days) use parallel mode to fit within Vercel 300s timeout
    const useParallel = datesToFetch.length > 3;
    let bpt: { inserted: number; skipped: number; errors: string[] };

    if (useParallel) {
      bpt = await parallelFetchAndStore(envGenres, datesToFetch);
    } else {
      const seq = await runBptoptrackerForDateRange(envGenres, datesToFetch);
      bpt = { inserted: seq.inserted, skipped: seq.skipped, errors: seq.errors };
    }

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
      mode: useParallel ? "parallel" : "sequential",
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
