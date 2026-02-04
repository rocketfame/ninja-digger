/**
 * Phase 4 — Materialize lead_scores from artist_lead_score view.
 * Call after ingestion so segments stay in sync. Deterministic, no LLM.
 */

import { pool } from "@/lib/db";

/**
 * Runs refresh_lead_scores() in DB. Returns number of rows upserted.
 */
export async function refreshLeadScores(): Promise<number> {
  const result = await pool.query<{ refresh_lead_scores: number }>(
    "SELECT refresh_lead_scores() AS refresh_lead_scores"
  );
  return Number(result.rows[0]?.refresh_lead_scores ?? 0);
}
