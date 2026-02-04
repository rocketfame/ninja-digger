/**
 * Phase 2 (hybrid) — Optional adapter: Songstats API (Beatport charts).
 * Secondary source. Implements IngestionSource for plug-in use.
 * Raw data without interpretation. No segmentation, enrichment, UI, LLM.
 */

import { query, pool } from "@/lib/db";
import type { ChartEntryInput, IngestionSource } from "@/ingest/types";

const SOURCE_SLUG = "songstats";
const SOURCE_NAME = "Songstats";

/** One chart row from API (minimal type; adjust to docs.songstats.com) */
export type BeatportChartRow = {
  position: number;
  trackTitle: string;
  artistName: string;
  labelName?: string | null;
};

/** IngestionSource adapter: fetchEntries returns ChartEntryInput[] for runIngest. */
export const SongstatsSource: IngestionSource = {
  sourceName: SOURCE_NAME,

  async fetchEntries(chartDate: string): Promise<ChartEntryInput[]> {
    const rows = await fetchBeatportChart(chartDate);
    return rows.map((r) => ({
      source: SOURCE_SLUG,
      chartType: "top100",
      genre: null,
      position: r.position,
      chartDate,
      artistName: r.artistName,
      trackTitle: r.trackTitle,
      labelName: r.labelName ?? null,
    }));
  },
};

/**
 * Returns or creates Songstats source in sources table (for direct use if needed).
 */
export async function getOrCreateSource(): Promise<number> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM sources WHERE slug = $1",
    [SOURCE_SLUG]
  );
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO sources (name, slug) VALUES ($1, $2) RETURNING id",
    [SOURCE_NAME, SOURCE_SLUG]
  );
  return (insert.rows[0] as { id: number }).id;
}

/**
 * Повертає або створює артиста за назвою.
 */
async function getOrCreateArtist(name: string): Promise<number> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM artists WHERE name = $1 LIMIT 1",
    [name]
  );
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO artists (name) VALUES ($1) RETURNING id",
    [name]
  );
  return (insert.rows[0] as { id: number }).id;
}

/**
 * Повертає або створює лейбл за назвою.
 */
async function getOrCreateLabel(name: string | null | undefined): Promise<number | null> {
  if (!name || name.trim() === "") return null;
  const rows = await query<{ id: number }>(
    "SELECT id FROM labels WHERE name = $1 LIMIT 1",
    [name.trim()]
  );
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO labels (name) VALUES ($1) RETURNING id",
    [name.trim()]
  );
  return (insert.rows[0] as { id: number }).id;
}

/**
 * Повертає або створює трек за title + artist_id + label_id.
 */
async function getOrCreateTrack(
  title: string,
  artistId: number,
  labelId: number | null
): Promise<number> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM tracks WHERE artist_id = $1 AND title = $2 AND (($3::int IS NULL AND label_id IS NULL) OR label_id = $3) LIMIT 1",
    [artistId, title.trim(), labelId]
  );
  if (rows.length > 0) return rows[0].id;
  const insert = await pool.query(
    "INSERT INTO tracks (title, artist_id, label_id) VALUES ($1, $2, $3) RETURNING id",
    [title.trim(), artistId, labelId]
  );
  return (insert.rows[0] as { id: number }).id;
}

/**
 * Забирає Beatport chart з Songstats API для дати date (YYYY-MM-DD).
 * Ендпоінт і формат відповіді треба узгодити з docs.songstats.com.
 * Зараз повертає порожній масив, якщо SONGSTATS_API_KEY не заданий або API не доступний.
 */
export async function fetchBeatportChart(chartDate: string): Promise<BeatportChartRow[]> {
  const apiKey = process.env.SONGSTATS_API_KEY;
  const baseUrl = process.env.SONGSTATS_BASE_URL ?? "https://api.songstats.com";
  if (!apiKey) {
    console.warn("SONGSTATS_API_KEY not set; returning empty chart.");
    return [];
  }
  try {
    const url = `${baseUrl}/v1/charts/beatport?date=${chartDate}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      console.warn(`Songstats API error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = (await res.json()) as unknown;
    return normalizeChartResponse(data, chartDate);
  } catch (err) {
    console.warn("Songstats fetch error:", err);
    return [];
  }
}

/**
 * Приводить відповідь API до масиву BeatportChartRow.
 * Реальну структуру підлаштувати під docs.songstats.com.
 */
function normalizeChartResponse(data: unknown, chartDate: string): BeatportChartRow[] {
  if (!data || typeof data !== "object") return [];
  const arr = Array.isArray(data) ? data : (data as Record<string, unknown>).entries ?? (data as Record<string, unknown>).chart ?? [];
  if (!Array.isArray(arr)) return [];
  return arr.map((row: unknown, index: number) => {
    if (row && typeof row === "object" && "position" in row && "trackTitle" in row && "artistName" in row) {
      const r = row as Record<string, unknown>;
      return {
        position: Number(r.position) || index + 1,
        trackTitle: String(r.trackTitle ?? ""),
        artistName: String(r.artistName ?? ""),
        labelName: r.labelName != null ? String(r.labelName) : null,
      };
    }
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      return {
        position: Number(r.position ?? r.rank ?? index + 1),
        trackTitle: String(r.track_title ?? r.trackTitle ?? r.title ?? ""),
        artistName: String(r.artist_name ?? r.artistName ?? r.artist ?? ""),
        labelName: r.label_name != null || r.labelName != null ? String(r.label_name ?? r.labelName ?? "") : null,
      };
    }
    return {
      position: index + 1,
      trackTitle: "",
      artistName: "",
      labelName: null,
    };
  }).filter((r) => r.artistName.trim() !== "" || r.trackTitle.trim() !== "");
}

/**
 * Legacy: direct Songstats ingestion (same as runIngest('songstats', date)).
 * Prefer runIngest from ingest/run.ts for unified pipeline.
 */
export async function ingestBeatportChart(chartDate: string) {
  const { runIngest } = await import("@/ingest/run");
  return runIngest("songstats", chartDate);
}
