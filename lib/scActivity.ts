/** SoundCloud activity buckets from last real activity (last_track_at, fallback last_modified). */
export const SC_ACTIVITY = {
  hot: { label: "🔥 Активні ≤6 міс", months: 6 },
  warm: { label: "⏳ 6–12 міс", months: 12 },
  cool: { label: "💤 12–18 міс", months: 18 },
  dormant: { label: "⚰️ Сплячі >18 міс", months: 999 },
} as const;

export type ScActivityKey = keyof typeof SC_ACTIVITY;

/** SQL CASE expression → activity key, using best available activity date. */
export const SC_ACTIVITY_SQL = `CASE
  WHEN COALESCE(last_track_at, last_modified) >= now() - interval '6 months' THEN 'hot'
  WHEN COALESCE(last_track_at, last_modified) >= now() - interval '12 months' THEN 'warm'
  WHEN COALESCE(last_track_at, last_modified) >= now() - interval '18 months' THEN 'cool'
  ELSE 'dormant'
END`;

/**
 * The two SoundCloud engines write to the same table and are told apart by
 * source_seed. `reex` is the finite Re-Ex seed list and its followers (plus
 * legacy rows with no source recorded); `graph` is the producer-graph crawl.
 * Each is its own segment and its own tab: their leads come from different
 * places and are worked at different speeds, and mixing them would hide
 * whether either engine is actually producing.
 */
export const SC_SOURCE = {
  reex:  { label: "Репост SC парсер", sql: "(COALESCE(source_seed,'') NOT LIKE 'graph:%' AND COALESCE(source_seed,'') NOT LIKE 'upload:%')" },
  graph: { label: "SoundCloud парсер", sql: "(COALESCE(source_seed,'') LIKE 'graph:%' OR COALESCE(source_seed,'') LIKE 'upload:%')" },
} as const;
export type ScSourceKey = keyof typeof SC_SOURCE;
export function scSource(key: string | null | undefined): ScSourceKey {
  return key === "graph" ? "graph" : "reex";
}
