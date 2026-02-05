/**
 * Shared pipeline: discovery → ingest → normalize → score.
 * Updates discovery_runs for UI progress. Used by cron and by internal Run Discovery API.
 */

import { pool } from "@/lib/db";
import { runBeatportDiscovery } from "@/ingest/discovery/runDiscovery";
import { runIngest } from "@/ingest/run";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

export type DiscoveryRunId = string;

async function updateRun(
  runId: string,
  updates: {
    status?: string;
    stage?: string;
    progress?: string;
    finished_at?: Date | null;
    charts_count?: number | null;
    artists_count?: number | null;
    leads_count?: number | null;
    error_message?: string | null;
  }
) {
  const set: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (updates.status !== undefined) {
    set.push(`status = $${i++}`);
    values.push(updates.status);
  }
  if (updates.stage !== undefined) {
    set.push(`stage = $${i++}`);
    values.push(updates.stage);
  }
  if (updates.progress !== undefined) {
    set.push(`progress = $${i++}`);
    values.push(updates.progress);
  }
  if (updates.finished_at !== undefined) {
    set.push(`finished_at = $${i++}`);
    values.push(updates.finished_at);
  }
  if (updates.charts_count !== undefined) {
    set.push(`charts_count = $${i++}`);
    values.push(updates.charts_count);
  }
  if (updates.artists_count !== undefined) {
    set.push(`artists_count = $${i++}`);
    values.push(updates.artists_count);
  }
  if (updates.leads_count !== undefined) {
    set.push(`leads_count = $${i++}`);
    values.push(updates.leads_count);
  }
  if (updates.error_message !== undefined) {
    set.push(`error_message = $${i++}`);
    values.push(updates.error_message);
  }
  if (set.length === 0) return;
  values.push(runId);
  await pool.query(
    `UPDATE discovery_runs SET ${set.join(", ")} WHERE id = $${i}`,
    values
  );
}

/**
 * Run full pipeline and persist progress to discovery_runs.
 * Creates the run row; caller should insert it first and pass id.
 */
export async function runDiscoveryPipeline(runId: string): Promise<void> {
  const chartDate = new Date().toISOString().slice(0, 10);

  try {
    await updateRun(runId, { stage: "discovery", progress: "Discovering charts…" });

    const discovery = await runBeatportDiscovery();
    await updateRun(runId, {
      stage: "discovery",
      progress: `Charts: ${discovery.upserted} (${discovery.chartUrlsSeen} seen)`,
    });

    await updateRun(runId, { stage: "ingest", progress: "Ingesting chart entries…" });
    const ingestResult = await runIngest("beatport", chartDate);
    await updateRun(runId, {
      stage: "ingest",
      progress: `Fetched ${ingestResult.fetched}, inserted ${ingestResult.inserted}`,
    });

    await updateRun(runId, { stage: "normalize", progress: "Normalizing metrics…" });
    const metricsUpdated = await refreshArtistMetrics();
    await updateRun(runId, {
      stage: "normalize",
      progress: `Updated ${metricsUpdated} artists`,
    });

    await updateRun(runId, { stage: "score", progress: "Computing lead scores…" });
    const scoresUpdated = await refreshLeadScoresV2();
    await updateRun(runId, {
      stage: "score",
      progress: `Updated ${scoresUpdated} lead scores`,
    });

    const counts = await pool.query<{ charts_count: string; artists_count: string; leads_count: string }>(
      `SELECT
        (SELECT COUNT(*) FROM charts_catalog)::text AS charts_count,
        (SELECT COUNT(*) FROM artist_metrics)::text AS artists_count,
        (SELECT COUNT(*) FROM lead_scores)::text AS leads_count`
    );
    const row = counts.rows[0];

    await updateRun(runId, {
      status: "completed",
      finished_at: new Date(),
      stage: "score",
      progress: null,
      charts_count: row ? parseInt(row.charts_count, 10) : 0,
      artists_count: row ? parseInt(row.artists_count, 10) : 0,
      leads_count: row ? parseInt(row.leads_count, 10) : 0,
      error_message: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, {
      status: "error",
      finished_at: new Date(),
      error_message: message,
    });
    throw err;
  }
}
