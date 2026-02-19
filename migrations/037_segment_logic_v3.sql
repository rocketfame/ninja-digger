-- Migration 037: Redefine segment logic based on business strategy
--
-- NEWCOMER (1-4 days, position > 30, active) — hot leads for Daily Push
-- NEW_ENTRY (5-7 days, active) — still in the opportunity window
-- FAST_GROWING (momentum_7d > 3) — track gaining momentum, amplify the wave
-- TOP_PERFORMER (best_position <= 10, 8+ days) — established top chart presence
-- DECLINING (momentum_7d < -3, 5+ days) — offer rescue push
-- CONSISTENT (8-30 days, stable) — long-term service potential

CREATE OR REPLACE FUNCTION refresh_lead_scores_v2()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  updated INT;
  ref_date DATE;
  w1 NUMERIC := 2;
  w2 NUMERIC := 1;
  w3 NUMERIC := 3;
  w4 NUMERIC := 1;
BEGIN
  SELECT MAX(snapshot_date) INTO ref_date FROM chart_entries;
  IF ref_date IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO lead_scores (artist_beatport_id, score, segment, signals, updated_at)
  SELECT
    m.artist_beatport_id,
    (
      w1 * LEAST(COALESCE(m.total_days_in_charts, 0) / 30.0, 1.0)
      + w2 * (100.0 - COALESCE(m.avg_position, 50)) / 100.0
      + w3 * COALESCE(m.momentum_30d, m.momentum_7d, 0) / 10.0
      + w4 * GREATEST(0, 1.0 - (ref_date - m.last_seen)::NUMERIC / 30.0)
    )::NUMERIC(10,2),

    CASE
      -- NEWCOMER: 1-4 days in charts, lower positions (>60), active within last 4 days
      WHEN COALESCE(m.total_days_in_charts, 0) BETWEEN 1 AND 4
           AND COALESCE(m.best_position, 99) > 60
           AND m.last_seen >= ref_date - 4
        THEN 'NEWCOMER'

      -- NEW_ENTRY: 5-7 days in charts, still active
      WHEN COALESCE(m.total_days_in_charts, 0) BETWEEN 5 AND 7
           AND m.last_seen >= ref_date - 7
        THEN 'NEW_ENTRY'

      -- FAST_GROWING: strong positive momentum (regardless of tenure)
      WHEN COALESCE(m.momentum_7d, 0) > 3
        THEN 'FAST_GROWING'

      -- TOP_PERFORMER: reached top-10 and has been around 8+ days
      WHEN COALESCE(m.best_position, 99) <= 10
           AND COALESCE(m.total_days_in_charts, 0) >= 8
        THEN 'TOP_PERFORMER'

      -- DECLINING: losing momentum, was in charts at least 5 days
      WHEN COALESCE(m.momentum_7d, 0) < -3
           AND COALESCE(m.total_days_in_charts, 0) >= 5
        THEN 'DECLINING'

      -- CONSISTENT: 8-30 days, not strongly declining
      WHEN COALESCE(m.total_days_in_charts, 0) BETWEEN 8 AND 30
           AND COALESCE(m.momentum_7d, 0) >= -3
        THEN 'CONSISTENT'

      -- Fallback for 1-4 days but higher position (<=60) — still new, classify as NEW_ENTRY
      WHEN COALESCE(m.total_days_in_charts, 0) BETWEEN 1 AND 4
           AND COALESCE(m.best_position, 99) <= 60
        THEN 'NEW_ENTRY'

      -- Fallback: long-tenured artists
      WHEN COALESCE(m.total_days_in_charts, 0) > 30
        THEN 'CONSISTENT'

      ELSE 'NEW_ENTRY'
    END,

    jsonb_build_object(
      'total_days_in_charts', m.total_days_in_charts,
      'avg_position', m.avg_position,
      'best_position', m.best_position,
      'momentum_7d', m.momentum_7d,
      'momentum_30d', m.momentum_30d,
      'first_seen', m.first_seen,
      'last_seen', m.last_seen
    ),
    NOW()
  FROM artist_metrics m
  ON CONFLICT (artist_beatport_id) DO UPDATE SET
    score = EXCLUDED.score,
    segment = EXCLUDED.segment,
    signals = EXCLUDED.signals,
    updated_at = NOW();
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$function$;
