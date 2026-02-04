-- Ninja Digger — Phase 4: Segmentation & Scoring (Multi-Signal SQL)
-- Signals: A=appearances, P=avg_position, R=recency_days, M=momentum, S=source_count
-- Run after 006.

-- 1. Сигнали по артисту (все джерела)
CREATE OR REPLACE VIEW artist_signals AS
SELECT
  a.id AS artist_id,
  a.name AS artist_name,
  COUNT(ce.id)::INT AS appearances,
  AVG(ce.position)::NUMERIC(10,2) AS avg_position,
  MIN(ce.chart_date)::DATE AS first_seen,
  MAX(ce.chart_date)::DATE AS last_seen,
  (CURRENT_DATE - MAX(ce.chart_date)::DATE)::INT AS recency_days,
  COUNT(DISTINCT ce.source_id)::INT AS source_count,
  -- momentum: avg position 8–14 days ago minus avg position last 7 days (positive = improved)
  (
    AVG(CASE WHEN ce.chart_date >= CURRENT_DATE - 14 AND ce.chart_date < CURRENT_DATE - 7 THEN ce.position END)::NUMERIC(10,2)
    - AVG(CASE WHEN ce.chart_date >= CURRENT_DATE - 7 THEN ce.position END)::NUMERIC(10,2)
  ) AS momentum
FROM artists a
JOIN tracks t ON t.artist_id = a.id
JOIN chart_entries ce ON ce.track_id = t.id
GROUP BY a.id, a.name;

COMMENT ON VIEW artist_signals IS 'Phase 4: A, P, R, M, S for lead scoring';
