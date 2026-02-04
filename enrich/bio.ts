/**
 * Phase 6 — Enrichment (Hybrid, Optional).
 * Bio summarization, role classification, short insight. Stored separately; no impact on segmentation.
 * LLM is optional; system works with enrichment disabled or empty.
 */

import { query, pool } from "@/lib/db";

export type EnrichmentRow = {
  artist_id: number;
  bio_summary: string | null;
  role: string | null;
  insight: string | null;
  enriched_at: string;
};

/**
 * Get cached enrichment for an artist. Returns null if none.
 */
export async function getEnrichment(artistId: number): Promise<EnrichmentRow | null> {
  const rows = await query<EnrichmentRow>(
    `SELECT artist_id, bio_summary, role, insight, enriched_at::text AS enriched_at
     FROM artist_enrichment WHERE artist_id = $1`,
    [artistId]
  );
  return rows[0] ?? null;
}

export type EnrichmentInput = {
  bio_summary?: string | null;
  role?: string | null;
  insight?: string | null;
};

/**
 * Save enrichment for an artist (upsert). Idempotent.
 */
export async function setEnrichment(
  artistId: number,
  data: EnrichmentInput
): Promise<void> {
  await pool.query(
    `INSERT INTO artist_enrichment (artist_id, bio_summary, role, insight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (artist_id)
     DO UPDATE SET
       bio_summary = EXCLUDED.bio_summary,
       role = EXCLUDED.role,
       insight = EXCLUDED.insight,
       enriched_at = NOW()`,
    [
      artistId,
      data.bio_summary ?? null,
      data.role ?? null,
      data.insight ?? null,
    ]
  );
}

/**
 * Optional: run LLM-based enrichment for an artist (e.g. bio summarization, role).
 * If no LLM API key is set, no-op. Call once per artist max when enabled.
 */
export async function enrichArtistWithLLM(_artistId: number): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.ENRICHMENT_LLM_API_KEY;
  if (!apiKey) {
    return false;
  }
  // Placeholder: integrate with OpenAI/other LLM when needed.
  // Fetch artist name, optional external bio, then summarize → setEnrichment(...).
  void apiKey;
  return false;
}
