-- Ninja Digger — Phase 4: Lead score formula + segments
-- score = (A*2) + (100-P) + max(0, 30-R) + (M*3) + (S*5)
-- Segments: core | regular | fresh | momentum | flyers
-- Run after 007.

CREATE OR REPLACE VIEW artist_lead_score AS
SELECT
  artist_id,
  artist_name,
  appearances,
  avg_position,
  first_seen,
  last_seen,
  recency_days,
  source_count,
  COALESCE(momentum, 0) AS momentum,
  (
    (COALESCE(appearances, 0) * 2)
    + (100 - COALESCE(avg_position, 50))
    + GREATEST(0, 30 - COALESCE(recency_days, 999))
    + (COALESCE(momentum, 0) * 3)
    + (COALESCE(source_count, 0) * 5)
  )::NUMERIC(10,2) AS score,
  CASE
    WHEN COALESCE(appearances, 0) >= 10 AND COALESCE(avg_position, 99) <= 30 THEN 'core'
    WHEN COALESCE(appearances, 0) >= 5 THEN 'regular'
    WHEN first_seen >= CURRENT_DATE - 14 THEN 'fresh'
    WHEN COALESCE(momentum, 0) > 0 THEN 'momentum'
    ELSE 'flyers'
  END AS segment
FROM artist_signals;

COMMENT ON VIEW artist_lead_score IS 'Phase 4: lead score and segment per artist (deterministic)';

-- 2. Функція оновлення таблиці lead_scores з view (для cron або ручного виклику)
CREATE OR REPLACE FUNCTION refresh_lead_scores()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  updated INT;
BEGIN
  INSERT INTO lead_scores (artist_id, score, segment)
  SELECT artist_id, score, segment FROM artist_lead_score
  ON CONFLICT (artist_id)
  DO UPDATE SET
    score = EXCLUDED.score,
    segment = EXCLUDED.segment,
    computed_at = NOW();
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

COMMENT ON FUNCTION refresh_lead_scores IS 'Phase 4: materialize artist_lead_score into lead_scores table';
