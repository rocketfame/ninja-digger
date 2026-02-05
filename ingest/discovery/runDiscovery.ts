/**
 * Run Beatport chart discovery: fetch genres → chart links → upsert charts_catalog (v2).
 * Mark charts not seen this run as is_active=false.
 */

import { pool } from "@/lib/db";
import {
  fetchHtml,
  parseGenres,
  parseChartLinks,
  classifyChartFamily,
} from "./beatportDiscovery";

const BEATPORT_ORIGIN = "https://www.beatport.com";
// Charts page lists genres; homepage often has no /genre/ links in HTML.
const GENRE_INDEX_URL = process.env.BEATPORT_GENRE_INDEX_URL ?? `${BEATPORT_ORIGIN}/charts`;
const PLATFORM = "beatport";

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

    const today = new Date().toISOString().slice(0, 10);

    for (const genre of genres) {
      try {
        const genreHtml = await fetchHtml(genre.genre_url);
        const chartLinks = parseChartLinks(genreHtml, genre.genre_url, genre);

        for (const link of chartLinks) {
          seenUrlsThisRun.add(link.url);
          const chartType = classifyChartFamily(link.url, link.title);

          const upsertRes = await pool.query(
            `INSERT INTO charts_catalog (
              platform, chart_type, genre_slug, genre_name, url, is_active, discovered_at, last_checked_at, notes
            ) VALUES ($1, $2, $3, $4, $5, true, $6::date, $6::date, $7)
            ON CONFLICT (url) DO UPDATE SET
              last_checked_at = $6::date,
              is_active = true,
              chart_type = EXCLUDED.chart_type,
              genre_slug = COALESCE(EXCLUDED.genre_slug, charts_catalog.genre_slug),
              genre_name = COALESCE(EXCLUDED.genre_name, charts_catalog.genre_name),
              notes = COALESCE(EXCLUDED.notes, charts_catalog.notes)`,
            [
              PLATFORM,
              chartType,
              genre.genre_slug,
              genre.genre_name,
              link.url,
              today,
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
         WHERE platform = $1 AND NOT (url = ANY($2::text[]))`,
        [PLATFORM, seenArray]
      );
      result.markedInactive = inactiveRes.rowCount ?? 0;
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}
