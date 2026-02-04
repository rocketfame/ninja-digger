-- Ninja Digger — Phase 3: Normalized views (clean chart history per entity)
-- Run after 005. Source-agnostic aggregates.

-- Чиста історія чартів по артисту (нормалізований artist_id)
CREATE OR REPLACE VIEW artist_chart_stats AS
SELECT
  a.id AS artist_id,
  a.name AS artist_name,
  a.normalized_name AS artist_normalized_name,
  COUNT(ce.id) AS appearances,
  MIN(ce.chart_date) AS first_seen,
  MAX(ce.chart_date) AS last_seen,
  AVG(ce.position)::NUMERIC(10,2) AS avg_position,
  COUNT(DISTINCT ce.source_id) AS source_count
FROM artists a
JOIN tracks t ON t.artist_id = a.id
JOIN chart_entries ce ON ce.track_id = t.id
GROUP BY a.id, a.name, a.normalized_name;

COMMENT ON VIEW artist_chart_stats IS 'Phase 3: normalized artist stats across all sources';

-- Історія чартів по артисту з датами (для деталей)
CREATE OR REPLACE VIEW artist_chart_history AS
SELECT
  a.id AS artist_id,
  a.name AS artist_name,
  s.slug AS source_slug,
  ce.chart_date,
  ce.position,
  ce.chart_type,
  ce.genre,
  t.title AS track_title,
  l.name AS label_name
FROM artists a
JOIN tracks t ON t.artist_id = a.id
JOIN chart_entries ce ON ce.track_id = t.id
LEFT JOIN labels l ON l.id = t.label_id
JOIN sources s ON s.id = ce.source_id
ORDER BY ce.chart_date DESC, ce.position;

COMMENT ON VIEW artist_chart_history IS 'Phase 3: raw chart history per artist (source-aware)';
