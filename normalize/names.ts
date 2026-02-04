/**
 * Phase 3 — Name normalization. Same logical entity across sources.
 * SQL-only logic; no AI. Used for matching artists/labels.
 */

/**
 * Normalize name for matching: trim, lowercase, collapse multiple spaces.
 * Used when finding or creating artist/label by normalized_name.
 */
export function normalizeName(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
