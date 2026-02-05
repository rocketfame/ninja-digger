/**
 * v2 — Legacy wrapper: call refresh_lead_scores_v2 (migration 013).
 * Prefer importing refreshLeadScoresV2 from @/segment/score.
 */

import { refreshLeadScoresV2 } from "@/segment/score";

/** @deprecated Use refreshLeadScoresV2 from @/segment/score after normalize. */
export async function refreshLeadScores(): Promise<number> {
  return refreshLeadScoresV2();
}
