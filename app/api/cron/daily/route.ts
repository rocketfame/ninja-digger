/**
 * Щоденний cron (двічі на добу: 06:00 та 18:00 UTC).
 * Discovery (неділя) + ingest + BPTT daily (вчора+сьогодні) → sync BPTT→chart_entries → normalize + score.
 * Синхронізацію ретро з лідами та перерахунок сегментів не потрібно викликати вручну.
 */

import { NextResponse } from "next/server";
import { runBeatportDiscovery } from "@/ingest/discovery/runDiscovery";
import { runIngest } from "@/ingest/run";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";
import { runBptoptrackerDailyUpdate } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — discovery може тривати

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chartDate = new Date().toISOString().slice(0, 10);
  const isSunday = new Date().getDay() === 0;

  const result: {
    ok: boolean;
    discovery?: { genresFetched: number; upserted: number; errors: string[] };
    ingest?: { fetched: number; inserted: number; skipped: number };
    bptoptracker?: { genres: string[]; inserted: number; skipped: number; errors: string[] };
    metricsUpdated?: number;
    scoresUpdated?: number;
    cleanup?: { url_cache: number; enrichment_runs: number; old_chart_entries: number; bptoptracker_daily: number };
    error?: string;
  } = { ok: true };

  try {
    // Пряме скрапінгування beatport.com вимкнено: Cloudflare віддає 403, а джерело
    // чартів за правилами проєкту — BP Top Tracker. Увімкнути можна через env.
    if (isSunday && process.env.ENABLE_BEATPORT_DIRECT === "1") {
      const discovery = await runBeatportDiscovery();
      result.discovery = {
        genresFetched: discovery.genresFetched,
        upserted: discovery.upserted,
        errors: discovery.errors,
      };
      if (process.env.NODE_ENV !== "test") {
        console.log("[cron/daily] discovery", discovery.upserted, "charts");
      }
    }

    if (process.env.ENABLE_BEATPORT_DIRECT === "1") {
      const ingestResult = await runIngest("beatport", chartDate);
      result.ingest = {
        fetched: ingestResult.fetched,
        inserted: ingestResult.inserted,
        skipped: ingestResult.skipped,
      };
    }

    const bpt = await runBptoptrackerDailyUpdate();
    if (bpt.genres.length > 0) {
      result.bptoptracker = {
        genres: bpt.genres,
        inserted: bpt.inserted,
        skipped: bpt.skipped,
        errors: bpt.errors,
      };
      await syncBptoptrackerToChartEntries();
    }

    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();
    result.metricsUpdated = metricsUpdated;
    result.scoresUpdated = scoresUpdated;

    // --- DB Cleanup: видаляємо старі дані щоб не перевищити Neon 512 MB ---
    const cleanup = { url_cache: 0, enrichment_runs: 0, old_chart_entries: 0, bptoptracker_daily: 0 };
    try {
      // url_cache: чистий HTML-кеш, регенерується. DELETE лишає мертві рядки
      // (розмір не падає без VACUUM), тому щодня робимо TRUNCATE — файли
      // звільняються одразу, кеш тримається біля нуля.
      const c1 = await pool.query("SELECT COUNT(*)::int c FROM url_cache");
      await pool.query("TRUNCATE url_cache");
      cleanup.url_cache = c1.rows[0]?.c ?? 0;

      // enrichment_runs: логи запусків, тримаємо 7 днів
      const c2 = await pool.query("DELETE FROM enrichment_runs WHERE started_at < NOW() - INTERVAL '7 days'");
      cleanup.enrichment_runs = c2.rowCount ?? 0;

      // chart_entries: тримаємо 45 днів (momentum_30d потребує ≥30 + буфер).
      // Було 56 → БД повзла до 365MB; 45 тримає плато нижчим.
      const c3 = await pool.query("DELETE FROM chart_entries WHERE snapshot_date < CURRENT_DATE - 45");
      cleanup.old_chart_entries = c3.rowCount ?? 0;

      // bptoptracker_daily: сирі денні знімки (вже синхронізовані в chart_entries),
      // 30 днів більш ніж достатньо.
      const c4 = await pool.query("DELETE FROM bptoptracker_daily WHERE snapshot_date < CURRENT_DATE - 30");
      cleanup.bptoptracker_daily = c4.rowCount ?? 0;

      // outreach_events: аудит-лог розсилки, 120 днів достатньо (інакше росте безмежно)
      const c5 = await pool.query("DELETE FROM outreach_events WHERE sent_at < now() - interval '120 days'");
      (cleanup as Record<string, number>).outreach_events = c5.rowCount ?? 0;

      // notified_replies: дедуп вхідних відповідей. IMAP-скан дивиться назад 3 дні,
      // тож 90 днів історії з великим запасом; далі росло б безмежно.
      const c6 = await pool.query("DELETE FROM notified_replies WHERE notified_at < now() - interval '90 days'").catch(() => ({ rowCount: 0 }));
      (cleanup as Record<string, number>).notified_replies = c6.rowCount ?? 0;

      // tg_notifications: мапінг TG-повідомлення→лід для Approve/Reply, 180 днів.
      const c7 = await pool.query("DELETE FROM tg_notifications WHERE created_at < now() - interval '180 days'").catch(() => ({ rowCount: 0 }));
      (cleanup as Record<string, number>).tg_notifications = c7.rowCount ?? 0;

      // Reclaim dead tuples from the DELETE-pruned tables so the file stops
      // creeping toward the Neon 512 MB cap (plain VACUUM = safe, no lock).
      await pool.query("VACUUM chart_entries, bptoptracker_daily, outreach_events").catch((e) => console.error("[cron/daily] vacuum:", e instanceof Error ? e.message : e));

      // Self-expanding seed pool — the key to never running dry. Every promoter
      // AND every harvested artist in the follower sweet-spot (500-100k: big
      // enough to have artist followers, not a mega-channel of fans) becomes a
      // harvest seed. Each seed's followers yield more artists → more seeds, so
      // the graph keeps growing on its own. Idempotent (ON CONFLICT keeps
      // existing cursors/progress). Capped per run so we never flood in one go.
      const seedSync = await pool.query(
        `INSERT INTO sc_seed_accounts (permalink, soundcloud_id, username, followers_count, active, priority)
         SELECT permalink, soundcloud_id, COALESCE(username, full_name, permalink), followers_count, true,
                CASE WHEN is_promoter THEN 2 ELSE 0 END
         FROM sc_artists a
         WHERE permalink IS NOT NULL
           AND (is_promoter = true OR followers_count BETWEEN 500 AND 100000)
           AND NOT EXISTS (SELECT 1 FROM sc_seed_accounts s WHERE s.permalink = a.permalink)
         ORDER BY (is_promoter) DESC, followers_count DESC
         LIMIT 20000
         ON CONFLICT (permalink) DO NOTHING`
      ).catch(() => ({ rowCount: 0 }));
      (cleanup as Record<string, number>).new_seeds = seedSync.rowCount ?? 0;

      result.cleanup = cleanup;
      console.log("[cron/daily] cleanup:", cleanup);
    } catch (cleanupErr) {
      console.error("[cron/daily] cleanup error:", cleanupErr);
    }

    if (process.env.NODE_ENV !== "test") {
      console.log("[cron/daily] done", { ingest: result.ingest, metricsUpdated, scoresUpdated, cleanup });
    }

    return NextResponse.json(result);
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[cron/daily]", result.error);
    return NextResponse.json(result, { status: 500 });
  }
}
