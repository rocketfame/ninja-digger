/**
 * Lead quality: junk-name guard and A/B/C tiering ("gold panning").
 * Tier A (перлини): strong chart presence AND currently active.
 * Tier B: decent position, recently active. Tier C: tail / stale.
 * SQL fragments expect artist_metrics aliased as `am`.
 */

/** Parsing artifacts and UI leakage — never usable as a greeting name. */
export const JUNK_NAME_SQL = `(
  am.artist_name IS NULL
  OR am.artist_name ~ '^[0-9 /#.\\-]+$'
  OR length(trim(am.artist_name)) <= 2
  OR am.artist_name ~* '(sign in|log ?in|cookie|about us|newsletter|privacy|terms of|http|www\\.|\\.com$)'
  OR am.artist_name ~ '[→↗⟶➔›]'
)`;

export const TIER_SQL = `CASE
  WHEN am.best_position <= 30 AND am.total_days_in_charts >= 3 AND am.last_seen >= current_date - 30 THEN 'A'
  WHEN am.best_position <= 60 AND am.last_seen >= current_date - 45 THEN 'B'
  ELSE 'C'
END`;
