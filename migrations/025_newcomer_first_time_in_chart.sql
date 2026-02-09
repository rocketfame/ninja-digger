-- Новачки: вперше з'явились у чарті (first_seen недавно), а не за кількістю днів.
-- NEWCOMER = перша поява в останні 14 днів («щойно залетіли»).

CREATE OR REPLACE FUNCTION refresh_lead_scores_v2()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  updated INT;
  w1 NUMERIC := 2;
  w2 NUMERIC := 1;
  w3 NUMERIC := 3;
  w4 NUMERIC := 1;
BEGIN
  INSERT INTO lead_scores (artist_beatport_id, score, segment, signals, updated_at)
  SELECT
    m.artist_beatport_id,
    (
      w1 * LEAST(COALESCE(m.total_days_in_charts, 0) / 30.0, 1.0)
      + w2 * (100.0 - COALESCE(m.avg_position, 50)) / 100.0
      + w3 * COALESCE(m.momentum_30d, m.momentum_7d, 0) / 10.0
      + w4 * GREATEST(0, 1.0 - (CURRENT_DATE - m.last_seen)::NUMERIC / 30.0)
    )::NUMERIC(10,2),
    CASE
      WHEN COALESCE(m.best_position, 99) <= 10 THEN 'TOP_PERFORMER'
      WHEN m.first_seen >= CURRENT_DATE - 14 THEN 'NEWCOMER'
      WHEN COALESCE(m.momentum_7d, 0) > 0 THEN 'FAST_GROWING'
      WHEN COALESCE(m.momentum_7d, 0) < 0 THEN 'DECLINING'
      WHEN m.total_days_in_charts <= 3 OR m.first_seen >= CURRENT_DATE - 5 THEN 'NEW_ENTRY'
      WHEN COALESCE(m.total_days_in_charts, 0) >= 30 THEN 'CONSISTENT'
      ELSE 'CONSISTENT'
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
$$;
