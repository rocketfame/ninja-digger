/**
 * GET /api/internal/debug/genre-data
 * Returns diagnostic data about genre coverage across bptoptracker_daily,
 * charts_catalog, chart_entries, artist_metrics. Used to debug missing genres.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getBptoptrackerGenreSlugs } from "@/lib/bptoptrackerGenres";

export async function GET() {
  try {
    const envGenresStr = process.env.BPTOPTRACKER_GENRES?.trim() ?? "";
    const envGenres = envGenresStr ? envGenresStr.split(",").map((g) => g.trim()).filter(Boolean) : [];
    const allGenresFromCode = getBptoptrackerGenreSlugs();

    const [
      dailyGenres,
      catalogGenres,
      ceGenres,
      amGenres,
      newcomerAfroCount,
    ] = await Promise.all([
      query<{ genre_slug: string; cnt: string }>(
        `SELECT genre_slug, COUNT(*)::text AS cnt FROM bptoptracker_daily GROUP BY genre_slug ORDER BY genre_slug`
      ),
      query<{ genre_slug: string | null; cnt: string }>(
        `SELECT cc.genre_slug, COUNT(*)::text AS cnt FROM charts_catalog cc WHERE cc.platform = 'bptoptracker' GROUP BY cc.genre_slug ORDER BY cc.genre_slug`
      ),
      query<{ genre_slug: string | null; cnt: string }>(
        `SELECT cc.genre_slug, COUNT(*)::text AS cnt FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker' GROUP BY cc.genre_slug ORDER BY cc.genre_slug`
      ),
      query<{ g: string }>(
        `SELECT DISTINCT unnest(genres) AS g FROM artist_metrics WHERE genres IS NOT NULL AND array_length(genres, 1) > 0 ORDER BY g`
      ),
      query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = 'NEWCOMER'
         AND ((am.genres IS NOT NULL AND 'afro-house' = ANY(am.genres))
              OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id
                         WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug = 'afro-house'))`
      ),
    ]);

    const dailySlugs = dailyGenres.map((r) => r.genre_slug);
    const catalogSlugs = catalogGenres.map((r) => r.genre_slug).filter(Boolean) as string[];
    const ceSlugs = ceGenres.map((r) => r.genre_slug).filter(Boolean) as string[];
    const amSlugs = amGenres.map((r) => r.g);

    const missingFromDaily = allGenresFromCode.filter((g) => !dailySlugs.includes(g));
    const missingFromAm = allGenresFromCode.filter((g) => !amSlugs.some((a) => a.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === g));

    const payload = {
      env: {
        BPTOPTRACKER_GENRES_count: envGenres.length,
        BPTOPTRACKER_GENRES_sample: envGenres.slice(0, 5),
        has_afro_house_in_env: envGenres.some((g) => g.includes("afro")),
      },
      code: { allGenresFromCode_count: allGenresFromCode.length },
      bptoptracker_daily: { count: dailySlugs.length, genres: dailySlugs.slice(0, 15), has_afro_house: dailySlugs.includes("afro-house") },
      charts_catalog: { count: catalogSlugs.length, has_afro_house: catalogSlugs.includes("afro-house") },
      chart_entries: { count: ceSlugs.length, has_afro_house: ceSlugs.includes("afro-house") },
      artist_metrics_distinct: { count: amSlugs.length, has_afro_house: amSlugs.some((g) => g.toLowerCase().includes("afro")) },
      missing_from_daily: missingFromDaily.length,
      missing_from_daily_sample: missingFromDaily.slice(0, 10),
      newcomer_afro_house_count: newcomerAfroCount[0]?.cnt ?? "0",
    };

    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
