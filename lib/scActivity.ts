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
