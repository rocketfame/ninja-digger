/**
 * Sync bptoptracker_daily → chart_entries. Optimized: bulk resolve artist IDs, batch INSERT.
 * BP Top Tracker uses Beatport API — artist IDs in chart links are Beatport artist IDs (one catalog).
 * Then run normalize + score so they appear in lead_scores.
 */

import { pool, query } from "@/lib/db";

const BATCH_SIZE = 200;

async function getOrCreateBptoptrackerChartId(genreSlug: string, chartType: "track" | "hype" = "track"): Promise<string> {
  const url = `https://bptoptracker.com/top/${chartType}/${genreSlug}`;
  const catalogType = chartType === "hype" ? "hype_tracks" : "top_tracks";
  const existing = await query<{ id: string }>(
    `SELECT id FROM charts_catalog WHERE platform = 'bptoptracker' AND url = $1`,
    [url]
  );
  if (existing.length > 0) return existing[0].id;
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO charts_catalog (platform, chart_type, genre_slug, url, is_active, discovered_at, last_checked_at)
     VALUES ('bptoptracker', $1, $2, $3, true, CURRENT_DATE, CURRENT_DATE)
     RETURNING id`,
    [catalogType, genreSlug, url]
  );
  const id = ins.rows[0]?.id;
  if (!id) throw new Error("Failed to create bptoptracker chart");
  return id;
}

/** Preload chart_id for all genres that appear in rows. */
async function preloadChartIds(genreSlugs: string[], chartType: "track" | "hype" = "track"): Promise<Map<string, string>> {
  const uniq = [...new Set(genreSlugs)];
  const map = new Map<string, string>();
  for (const slug of uniq) {
    try {
      map.set(slug, await getOrCreateBptoptrackerChartId(slug, chartType));
    } catch {
      // skip failed genre
    }
  }
  return map;
}

/** Synthetic ID for bptoptracker-only artists. */
function syntheticArtistId(artistName: string): string {
  const slug = artistName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `bptoptracker:${slug || "unknown"}`;
}

/**
 * Resolve artist_beatport_id for many names in 2 queries: manual links, then artist_metrics.
 * Returns Map: normalized (trimmed) name -> artist_beatport_id. Missing names use synthetic in caller.
 */
async function resolveArtistBeatportIdsBulk(
  uniqueNames: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const trimmed = uniqueNames.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return map;

  const manual = await query<{ artist_name: string; artist_beatport_id: string }>(
    `SELECT artist_name, artist_beatport_id FROM bptoptracker_artist_links WHERE artist_name = ANY($1::text[])`,
    [trimmed]
  );
  for (const r of manual) map.set(r.artist_name.trim().toLowerCase(), r.artist_beatport_id);

  const stillMissing = trimmed.filter((n) => !map.has(n.toLowerCase()));
  if (stillMissing.length === 0) return map;

  const metrics = await query<{ artist_name: string; artist_beatport_id: string }>(
    `SELECT DISTINCT ON (LOWER(TRIM(artist_name))) artist_name, artist_beatport_id
     FROM artist_metrics
     WHERE LOWER(TRIM(artist_name)) = ANY(SELECT LOWER(TRIM(x)) FROM unnest($1::text[]) AS x)
     ORDER BY LOWER(TRIM(artist_name)), artist_beatport_id`,
    [stillMissing]
  );
  for (const r of metrics) map.set(r.artist_name.trim().toLowerCase(), r.artist_beatport_id);
  return map;
}

export async function syncBptoptrackerToChartEntries(): Promise<{
  chartEntriesInserted: number;
  artistsMatched: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let chartEntriesInserted = 0;
  const matchedArtistIds = new Set<string>();

  const hasArtistIdColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_beatport_id' LIMIT 1`
  );
  const hasLinkPathColumnDaily = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bptoptracker_daily' AND column_name = 'artist_link_path' LIMIT 1`
  );
  const hasLinkPathColumnEntries = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'chart_entries' AND column_name = 'artist_link_path' LIMIT 1`
  );
  const withLinkPathDaily = hasLinkPathColumnDaily.rows.length > 0;
  const withLinkPathEntries = hasLinkPathColumnEntries.rows.length > 0;

  let selectSql: string;
  if (hasArtistIdColumn.rows.length > 0 && withLinkPathDaily) {
    selectSql = `SELECT snapshot_date::text, genre_slug, position, track_title, artist_name, label_name, released, artist_beatport_id, artist_link_path FROM bptoptracker_daily ORDER BY snapshot_date, genre_slug, position`;
  } else if (hasArtistIdColumn.rows.length > 0) {
    selectSql = `SELECT snapshot_date::text, genre_slug, position, track_title, artist_name, label_name, released, artist_beatport_id, NULL::text AS artist_link_path FROM bptoptracker_daily ORDER BY snapshot_date, genre_slug, position`;
  } else {
    selectSql = `SELECT snapshot_date::text, genre_slug, position, track_title, artist_name, label_name, released, NULL::text AS artist_beatport_id, NULL::text AS artist_link_path FROM bptoptracker_daily ORDER BY snapshot_date, genre_slug, position`;
  }

  const rows = await query<{
    snapshot_date: string;
    genre_slug: string;
    position: number;
    track_title: string | null;
    artist_name: string;
    label_name: string | null;
    released: string | null;
    artist_beatport_id: string | null;
    artist_link_path: string | null;
  }>(selectSql);

  if (rows.length === 0) {
    return { chartEntriesInserted: 0, artistsMatched: 0, errors: [] };
  }

  const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const genreSlugs = rows.map((r) => r.genre_slug);
  const regularSlugs = genreSlugs.filter((s) => !s.startsWith("hype:")).map((s) => toSlug(s));
  const hypeSlugs = genreSlugs.filter((s) => s.startsWith("hype:")).map((s) => toSlug(s.replace(/^hype:/, "")));
  const regularChartIds = await preloadChartIds([...new Set(regularSlugs)], "track");
  const hypeChartIds = await preloadChartIds([...new Set(hypeSlugs)], "hype");
  const genreChartIds = new Map<string, string>();
  for (const [k, v] of regularChartIds) genreChartIds.set(k, v);
  for (const [k, v] of hypeChartIds) genreChartIds.set(`hype:${k}`, v);

  const uniqueArtistNames = [...new Set(rows.map((r) => r.artist_name.trim()).filter(Boolean))];
  const artistIdMap = await resolveArtistBeatportIdsBulk(uniqueArtistNames);

  const toInsert: {
    chart_id: string;
    snapshot_date: string;
    position: number;
    track_title: string | null;
    artist_name: string;
    artist_beatport_id: string;
    label_name: string | null;
    release_title: string | null;
    artist_link_path: string | null;
  }[] = [];

  for (const row of rows) {
    const slug = row.genre_slug.startsWith("hype:") ? `hype:${toSlug(row.genre_slug.replace(/^hype:/, ""))}` : toSlug(row.genre_slug);
    const chartId = genreChartIds.get(slug);
    if (!chartId) continue;

    const trimmed = row.artist_name.trim();
    const fromChartLink = row.artist_beatport_id?.trim() && /^\d+$/.test(row.artist_beatport_id.trim())
      ? row.artist_beatport_id.trim()
      : null;
    const artistBeatportId = trimmed ? artistIdMap.get(trimmed.toLowerCase()) ?? null : null;
    const resolvedId = fromChartLink ?? artistBeatportId ?? syntheticArtistId(row.artist_name);
    const linkPath = fromChartLink && row.artist_link_path?.trim() ? row.artist_link_path.trim() : null;

    matchedArtistIds.add(resolvedId);
    toInsert.push({
      chart_id: chartId,
      snapshot_date: row.snapshot_date,
      position: row.position,
      track_title: row.track_title,
      artist_name: row.artist_name,
      artist_beatport_id: resolvedId,
      label_name: row.label_name,
      release_title: row.released,
      artist_link_path: linkPath,
    });
  }

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const values: (string | number | null)[] = [];
    const placeholders: string[] = [];
    let param = 1;
    for (const r of batch) {
      if (withLinkPathEntries) {
        placeholders.push(
          `($${param}, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}, $${param + 7}, $${param + 8}, 'bptoptracker')`
        );
        values.push(
          r.chart_id,
          r.snapshot_date,
          r.position,
          r.track_title,
          r.artist_name,
          r.artist_beatport_id,
          r.label_name,
          r.release_title,
          r.artist_link_path
        );
        param += 9;
      } else {
        placeholders.push(
          `($${param}, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}, $${param + 7}, 'bptoptracker')`
        );
        values.push(
          r.chart_id,
          r.snapshot_date,
          r.position,
          r.track_title,
          r.artist_name,
          r.artist_beatport_id,
          r.label_name,
          r.release_title
        );
        param += 8;
      }
    }
    try {
      const insertCols = withLinkPathEntries
        ? "chart_id, snapshot_date, position, track_title, artist_name, artist_beatport_id, label_name, release_title, artist_link_path, source"
        : "chart_id, snapshot_date, position, track_title, artist_name, artist_beatport_id, label_name, release_title, source";
      const onConflict = withLinkPathEntries
        ? "ON CONFLICT (chart_id, snapshot_date, position) DO UPDATE SET artist_link_path = COALESCE(EXCLUDED.artist_link_path, chart_entries.artist_link_path)"
        : "ON CONFLICT (chart_id, snapshot_date, position) DO NOTHING";
      const result = await pool.query(
        `INSERT INTO chart_entries (${insertCols})
         VALUES ${placeholders.join(", ")}
         ${onConflict}`,
        values
      );
      chartEntriesInserted += result.rowCount ?? 0;
    } catch (e) {
      errors.push(`batch ${i / BATCH_SIZE + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    chartEntriesInserted,
    artistsMatched: matchedArtistIds.size,
    errors: errors.slice(0, 50),
  };
}
