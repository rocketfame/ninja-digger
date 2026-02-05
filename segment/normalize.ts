/**
 * v2 — Aggregate chart_entries into artist_metrics. Call after ingestion.
 */

import { pool } from "@/lib/db";

export async function refreshArtistMetrics(): Promise<number> {
  const result = await pool.query<{ refresh_artist_metrics: number }>(
    "SELECT refresh_artist_metrics() AS refresh_artist_metrics"
  );
  return Number(result.rows[0]?.refresh_artist_metrics ?? 0);
}
