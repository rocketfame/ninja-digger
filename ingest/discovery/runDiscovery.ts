/**
 * Run Beatport chart discovery: fetch genres → chart links → upsert charts_catalog.
 * Mark charts not seen this run as is_active=false (by last_seen_at threshold).
 */

import { pool } from "@/lib/db";
import {
  fetchHtml,
  parseGenres,
  parseChartLinks,
  classifyChartFamily,
} from "./beatportDiscovery";

const BEATPORT_ORIGIN = "https://www.beatport.com";
const GENRE_INDEX_URL = process.env.BEATPORT_GENRE_INDEX_URL ?? BEATPORT_ORIGIN;
const SOURCE = "beatport";

export type DiscoveryResult = {
  genresFetched: number;
  chartUrlsSeen: number;
  upserted: number;
  markedInactive: number;
  errors: string[];
};

export async function runBeatportDiscovery(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    genresFetched: 0,
    chartUrlsSeen: 0,
    upserted: 0,
    markedInactive: 0,
    errors: [],
  };

  const seenUrlsThisRun = new Set<string>();

  try {
    const indexHtml = await fetchHtml(GENRE_INDEX_URL);
    const genres = parseGenres(indexHtml, BEATPORT_ORIGIN);
    result.genresFetched = genres.length;

    if (genres.length === 0) {
      result.errors.push("No genres parsed from index; check BEATPORT_GENRE_INDEX_URL or page structure.");
    }

    for (const genre of genres) {
      try {
        const genreHtml = await fetchHtml(genre.genre_url);
        const chartLinks = parseChartLinks(genreHtml, genre.genre_url, genre);

        for (const link of chartLinks) {
          seenUrlsThisRun.add(link.url);
          const chartFamily = classifyChartFamily(link.url, link.title);

          const upsertRes = await pool.query(
            `INSERT INTO charts_catalog (
              source, url, chart_scope, chart_family, genre_slug, genre_name, title, is_active, last_seen_at, parse_version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), 'v1')
            ON CONFLICT (url) DO UPDATE SET
              last_seen_at = now(),
              is_active = true,
              title = COALESCE(EXCLUDED.title, charts_catalog.title),
              genre_slug = COALESCE(EXCLUDED.genre_slug, charts_catalog.genre_slug),
              genre_name = COALESCE(EXCLUDED.genre_name, charts_catalog.genre_name),
              chart_family = EXCLUDED.chart_family`,
            [
              SOURCE,
              link.url,
              "genre",
              chartFamily,
              genre.genre_slug,
              genre.genre_name,
              link.title ?? null,
            ]
          );
          result.upserted += upsertRes.rowCount ?? 0;
        }
        result.chartUrlsSeen += chartLinks.length;
      } catch (err) {
        result.errors.push(`Genre ${genre.genre_slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const seenArray = Array.from(seenUrlsThisRun);
    if (seenArray.length > 0) {
      const inactiveRes = await pool.query(
        `UPDATE charts_catalog
         SET is_active = false
         WHERE source = $1 AND NOT (url = ANY($2::text[]))
         RETURNING id`,
        [SOURCE, seenArray]
      );
      result.markedInactive = inactiveRes.rowCount ?? 0;
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}
