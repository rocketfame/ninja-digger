/**
 * v2 — Compute lead_scores from artist_metrics (segments + formula, signals JSONB).
 */

import { pool } from "@/lib/db";

export async function refreshLeadScoresV2(): Promise<number> {
  const result = await pool.query<{ refresh_lead_scores_v2: number }>(
    "SELECT refresh_lead_scores_v2() AS refresh_lead_scores_v2"
  );
  return Number(result.rows[0]?.refresh_lead_scores_v2 ?? 0);
}
