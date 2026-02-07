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
    if (dates.length > 120) {
      return NextResponse.json(
        { error: "Max 120 days per run. Use a shorter range." },
        { status: 400 }
      );
    }
    if (allGenres && dates.length > 60) {
      return NextResponse.json(
        { error: "Для «усі жанри» максимум 60 днів за один запуск (інакше занадто довго)." },
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

    const tasks: { genreSlug: string; date: string }[] = [];
    for (const genreSlug of genreSlugs) for (const date of dates) tasks.push({ genreSlug, date });

    const errors: string[] = [];
    const allRows: BptoptrackerDailyRow[] = [];

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      const chunk = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (t) => {
          try {
            const rows = await fetchChartForDate(t.genreSlug, t.date);
            return { genreSlug: t.genreSlug, date: t.date, rows };
          } catch (e) {
            return { genreSlug: t.genreSlug, date: t.date, error: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      for (const r of results) {
        if ("error" in r && r.error) errors.push(`${r.genreSlug}/${r.date}: ${r.error}`);
        if ("rows" in r && r.rows?.length) allRows.push(...r.rows);
      }
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    for (let j = 0; j < allRows.length; j += INSERT_BATCH_SIZE) {
      const batch = allRows.slice(j, j + INSERT_BATCH_SIZE);
      const values: (string | number | null)[] = [];
      const placeholders: string[] = [];
      let param = 1;
      for (const row of batch) {
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
      const result = await pool.query(
        `INSERT INTO bptoptracker_daily (snapshot_date, genre_slug, position, track_title, artist_name, artists_full, label_name, released, movement)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (snapshot_date, genre_slug, position) DO NOTHING`,
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

    return NextResponse.json({
      ok: true,
      genreSlug: allGenres ? "__all__" : genreSlugParam,
      genresProcessed: allGenres ? genreSlugs.length : undefined,
      datesRequested: dates.length,
      totalInserted,
      totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
      hint: hint || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
