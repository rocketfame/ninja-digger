/**
 * POST /api/internal/bptoptracker/backfill
 * Body: { genreSlug: string | "__all__", dateFrom: string (YYYY-MM-DD), dateTo: string (YYYY-MM-DD) }
 * When genreSlug === "__all__", runs backfill for all genres (same date range).
 * Optimized: parallel fetches (concurrency limit), batch INSERT.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBptoptrackerCookie, clearBptoptrackerCookieCache, getLastLoginError } from "@/lib/bptoptrackerAuth";
import { fetchChartForDate, dateRange, type BptoptrackerDailyRow } from "@/lib/bptoptrackerFetch";
import { getBptoptrackerGenreSlugs } from "@/lib/bptoptrackerGenres";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

const CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;
const INSERT_BATCH_SIZE = 150;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const genreSlugParam = typeof body?.genreSlug === "string" ? body.genreSlug.trim() : "";
    const dateFrom = typeof body?.dateFrom === "string" ? body.dateFrom.trim() : "";
    const dateTo = typeof body?.dateTo === "string" ? body.dateTo.trim() : "";

    if (!genreSlugParam || !dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "genreSlug, dateFrom, dateTo are required (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const allGenres = genreSlugParam === "__all__";
    const genreSlugs = allGenres ? getBptoptrackerGenreSlugs() : [genreSlugParam];

    const dates = dateRange(dateFrom, dateTo);
    const MAX_DAYS = 125; // ~4 months
    if (dates.length > MAX_DAYS) {
      return NextResponse.json(
        { error: `Максимум ${MAX_DAYS} днів за запуск (≈4 міс.). Зменш діапазон дат.` },
        { status: 400 }
      );
    }

    clearBptoptrackerCookieCache();
    const cookie = await getBptoptrackerCookie();
    if (!cookie) {
      const reason = getLastLoginError();
      return NextResponse.json(
        {
          ok: false,
          error: reason
            ? `Не вдалося залогінитись. ${reason}`
            : "Не вдалося залогінитись. Перевір BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env (або BPTOPTRACKER_COOKIE).",
        },
        { status: 401 }
      );
    }

    const tasks: { genreSlug: string; date: string; chartType: "track" | "hype" }[] = [];
    for (const genreSlug of genreSlugs)
      for (const date of dates)
        tasks.push({ genreSlug, date, chartType: "track" });

    const errors: string[] = [];
    const allRows: BptoptrackerDailyRow[] = [];

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      const chunk = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (t) => {
          try {
            const rows = await fetchChartForDate(t.genreSlug, t.date, t.chartType);
            return { genreSlug: t.genreSlug, date: t.date, chartType: t.chartType, rows };
          } catch (e) {
            return { genreSlug: t.genreSlug, date: t.date, chartType: t.chartType, error: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      for (const r of results) {
        if ("error" in r && r.error) errors.push(`${r.genreSlug}/${r.chartType}/${r.date}: ${r.error}`);
        if ("rows" in r && r.rows?.length) allRows.push(...r.rows);
      }
    }

    const hasArtistIdColumn = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_beatport_id' LIMIT 1`
    );
    const hasLinkPathColumn = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_link_path' LIMIT 1`
    );
    const withArtistId = hasArtistIdColumn.rows.length > 0;
    const withLinkPath = hasLinkPathColumn.rows.length > 0;

    let totalInserted = 0;
    let totalSkipped = 0;
    for (let j = 0; j < allRows.length; j += INSERT_BATCH_SIZE) {
      const batch = allRows.slice(j, j + INSERT_BATCH_SIZE);
      const values: (string | number | null)[] = [];
      const placeholders: string[] = [];
      let param = 1;
      for (const row of batch) {
        if (withArtistId && withLinkPath) {
          placeholders.push(`($${param}, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}, $${param + 7}, $${param + 8}, $${param + 9}, $${param + 10})`);
          values.push(
            row.snapshot_date,
            row.genre_slug,
            row.position,
            row.track_title,
            row.artist_name,
            row.artists_full,
            row.label_name,
            row.released,
            row.movement,
            row.artist_beatport_id ?? null,
            row.artist_link_path ?? null
          );
          param += 11;
        } else if (withArtistId) {
          placeholders.push(`($${param}, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}, $${param + 7}, $${param + 8}, $${param + 9})`);
          values.push(
            row.snapshot_date,
            row.genre_slug,
            row.position,
            row.track_title,
            row.artist_name,
            row.artists_full,
            row.label_name,
            row.released,
            row.movement,
            row.artist_beatport_id ?? null
          );
          param += 10;
        } else {
          placeholders.push(`($${param}, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}, $${param + 7}, $${param + 8})`);
          values.push(
            row.snapshot_date,
            row.genre_slug,
            row.position,
            row.track_title,
            row.artist_name,
            row.artists_full,
            row.label_name,
            row.released,
            row.movement
          );
          param += 9;
        }
      }
      const insertCols =
        withArtistId && withLinkPath
          ? "snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement, artist_beatport_id, artist_link_path"
          : withArtistId
            ? "snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement, artist_beatport_id"
            : "snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement";
      const onConflict =
        withArtistId && withLinkPath
          ? "ON CONFLICT (snapshot_date, genre_slug, position) DO UPDATE SET artist_beatport_id = COALESCE(EXCLUDED.artist_beatport_id, bptoptracker_daily.artist_beatport_id), artist_link_path = COALESCE(EXCLUDED.artist_link_path, bptoptracker_daily.artist_link_path)"
          : withArtistId
            ? "ON CONFLICT (snapshot_date, genre_slug, position) DO UPDATE SET artist_beatport_id = COALESCE(EXCLUDED.artist_beatport_id, bptoptracker_daily.artist_beatport_id)"
            : "ON CONFLICT (snapshot_date, genre_slug, position) DO NOTHING";
      const result = await pool.query(
        `INSERT INTO bptoptracker_daily (${insertCols}) VALUES ${placeholders.join(", ")} ${onConflict}`,
        values
      );
      const inserted = result.rowCount ?? 0;
      totalInserted += inserted;
      totalSkipped += batch.length - inserted;
    }

    const totalRequests = genreSlugs.length * dates.length;
    const all404 = errors.length > 0 && errors.every((e) => e.includes("HTTP 404"));
    const some404 = errors.some((e) => e.includes("HTTP 404"));
    let hint = "";
    if (all404 && errors.length >= totalRequests) {
      hint = " Усі запити 404 — перевір slug жанрів на bptoptracker.com.";
    } else if (some404) {
      hint = " Частина 404 — на bptoptracker може не бути даних за ці дати для деяких жанрів; вставлені дані збережено.";
    }

    let syncResult: { chartEntriesInserted: number; artistsMatched: number; metricsUpdated: number; scoresUpdated: number; errors?: string[] } | null = null;
    try {
      const sync = await syncBptoptrackerToChartEntries();
      const metricsUpdated = await refreshArtistMetrics();
      const scoresUpdated = await refreshLeadScoresV2();
      syncResult = {
        chartEntriesInserted: sync.chartEntriesInserted,
        artistsMatched: sync.artistsMatched,
        metricsUpdated,
        scoresUpdated,
        errors: sync.errors.length > 0 ? sync.errors : undefined,
      };
    } catch (syncErr) {
      syncResult = {
        chartEntriesInserted: 0,
        artistsMatched: 0,
        metricsUpdated: 0,
        scoresUpdated: 0,
        errors: [syncErr instanceof Error ? syncErr.message : String(syncErr)],
      };
    }

    return NextResponse.json({
      ok: true,
      genreSlug: allGenres ? "__all__" : genreSlugParam,
      genresProcessed: allGenres ? genreSlugs.length : undefined,
      datesRequested: dates.length,
      totalInserted,
      totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
      hint: hint || undefined,
      sync: syncResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
