-- Ninja Digger — v2 Schema (Technical Spec v2)
-- Beatport-only, append-only history, artist_beatport_id as key.
-- Run after 012. Drops legacy views/functions that depend on old chart_entries/lead_scores.
-- Index names use _v2_ suffix to avoid conflict with legacy table indexes after RENAME.

-- 1. Drop legacy views and function (depend on chart_entries by track_id, lead_scores by artist_id)
DROP VIEW IF EXISTS artist_lead_score;
DROP VIEW IF EXISTS artist_signals;
DROP VIEW IF EXISTS artist_chart_stats;
DROP VIEW IF EXISTS artist_chart_history;
DROP FUNCTION IF EXISTS refresh_lead_scores();

-- 2. Rename existing tables to _legacy
ALTER TABLE IF EXISTS charts_catalog RENAME TO charts_catalog_legacy;
ALTER TABLE IF EXISTS chart_entries RENAME TO chart_entries_legacy;
ALTER TABLE IF EXISTS lead_scores RENAME TO lead_scores_legacy;

-- Recreate views that depended on old chart_entries/lead_scores so legacy artist page still works
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
JOIN chart_entries_legacy ce ON ce.track_id = t.id
GROUP BY a.id, a.name, a.normalized_name;

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
JOIN chart_entries_legacy ce ON ce.track_id = t.id
LEFT JOIN labels l ON l.id = t.label_id
JOIN sources s ON s.id = ce.source_id
ORDER BY ce.chart_date DESC, ce.position;

-- 3. charts_catalog (v2)
CREATE TABLE charts_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL DEFAULT 'beatport',
  chart_type TEXT NOT NULL,
  genre_slug TEXT,
  genre_name TEXT,
  url TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  discovered_at DATE NOT NULL DEFAULT CURRENT_DATE,
  last_checked_at DATE,
  notes TEXT
);

CREATE INDEX idx_charts_catalog_v2_platform_active ON charts_catalog(platform, is_active);
CREATE INDEX idx_charts_catalog_v2_genre ON charts_catalog(genre_slug);

COMMENT ON TABLE charts_catalog IS 'v2: Beatport chart catalog; discovery fills this';

-- 4. chart_entries (v2) — raw snapshots, append-only
CREATE TABLE chart_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID NOT NULL REFERENCES charts_catalog(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  position INTEGER NOT NULL,
  track_title TEXT,
  artist_name TEXT,
  artist_slug TEXT,
  artist_beatport_id TEXT,
  label_name TEXT,
  release_title TEXT,
  source TEXT NOT NULL DEFAULT 'beatport',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (chart_id, snapshot_date, position)
);

CREATE INDEX idx_chart_entries_v2_artist_date ON chart_entries(artist_beatport_id, snapshot_date);
CREATE INDEX idx_chart_entries_v2_chart_date ON chart_entries(chart_id, snapshot_date);

COMMENT ON TABLE chart_entries IS 'v2: raw chart snapshots; idempotent per (chart_id, snapshot_date, position)';

-- 5. artist_metrics (v2) — derived, recalculated by normalize job
CREATE TABLE artist_metrics (
  artist_beatport_id TEXT PRIMARY KEY,
  artist_name TEXT,
  first_seen DATE,
  last_seen DATE,
  total_days_in_charts INTEGER,
  total_chart_entries INTEGER,
  avg_position NUMERIC,
  best_position INTEGER,
  genres TEXT[],
  chart_types TEXT[],
  momentum_7d NUMERIC,
  momentum_30d NUMERIC
);

COMMENT ON TABLE artist_metrics IS 'v2: aggregated metrics per artist; filled by /api/cron/normalize';

-- 6. lead_scores (v2)
CREATE TABLE lead_scores (
  artist_beatport_id TEXT PRIMARY KEY,
  score NUMERIC NOT NULL,
  segment TEXT NOT NULL,
  signals JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT lead_scores_segment_check CHECK (
    segment IN ('NEW_ENTRY', 'CONSISTENT', 'FAST_GROWING', 'DECLINING', 'TOP_PERFORMER')
  )
);

CREATE INDEX idx_lead_scores_v2_segment ON lead_scores(segment);

COMMENT ON TABLE lead_scores IS 'v2: lead score and segment; filled by /api/cron/score';

-- 7. Normalize: aggregate chart_entries → artist_metrics
CREATE OR REPLACE FUNCTION refresh_artist_metrics()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  updated INT;
BEGIN
  WITH ce AS (
    SELECT
      ce.artist_beatport_id,
      ce.artist_name,
      ce.snapshot_date,
      ce.position,
      cc.chart_type,
      cc.genre_slug
    FROM chart_entries ce
    JOIN charts_catalog cc ON cc.id = ce.chart_id
    WHERE ce.artist_beatport_id IS NOT NULL AND ce.artist_beatport_id <> ''
  ),
  latest_name AS (
    SELECT DISTINCT ON (artist_beatport_id) artist_beatport_id, artist_name
    FROM ce
    ORDER BY artist_beatport_id, snapshot_date DESC
  ),
  agg AS (
    SELECT
      ce.artist_beatport_id,
      ln.artist_name,
      MIN(ce.snapshot_date) AS first_seen,
      MAX(ce.snapshot_date) AS last_seen,
      COUNT(DISTINCT ce.snapshot_date)::INT AS total_days_in_charts,
      COUNT(*)::INT AS total_chart_entries,
      AVG(ce.position)::NUMERIC AS avg_position,
      MIN(ce.position)::INT AS best_position,
      ARRAY_AGG(DISTINCT ce.genre_slug) FILTER (WHERE ce.genre_slug IS NOT NULL) AS genres,
      ARRAY_AGG(DISTINCT ce.chart_type) AS chart_types,
      (AVG(ce.position) FILTER (WHERE ce.snapshot_date >= CURRENT_DATE - 14 AND ce.snapshot_date < CURRENT_DATE - 7)
       - AVG(ce.position) FILTER (WHERE ce.snapshot_date >= CURRENT_DATE - 7))::NUMERIC AS momentum_7d,
      (AVG(ce.position) FILTER (WHERE ce.snapshot_date >= CURRENT_DATE - 60 AND ce.snapshot_date < CURRENT_DATE - 30)
       - AVG(ce.position) FILTER (WHERE ce.snapshot_date >= CURRENT_DATE - 30))::NUMERIC AS momentum_30d
    FROM ce
    JOIN latest_name ln ON ln.artist_beatport_id = ce.artist_beatport_id
    GROUP BY ce.artist_beatport_id, ln.artist_name
  )
  INSERT INTO artist_metrics (
    artist_beatport_id, artist_name, first_seen, last_seen, total_days_in_charts, total_chart_entries,
    avg_position, best_position, genres, chart_types, momentum_7d, momentum_30d
  )
  SELECT
    artist_beatport_id, artist_name, first_seen, last_seen, total_days_in_charts, total_chart_entries,
    avg_position, best_position, genres, chart_types, momentum_7d, momentum_30d
  FROM agg
  ON CONFLICT (artist_beatport_id) DO UPDATE SET
    artist_name = EXCLUDED.artist_name,
    first_seen = EXCLUDED.first_seen,
    last_seen = EXCLUDED.last_seen,
    total_days_in_charts = EXCLUDED.total_days_in_charts,
    total_chart_entries = EXCLUDED.total_chart_entries,
    avg_position = EXCLUDED.avg_position,
    best_position = EXCLUDED.best_position,
    genres = EXCLUDED.genres,
    chart_types = EXCLUDED.chart_types,
    momentum_7d = EXCLUDED.momentum_7d,
    momentum_30d = EXCLUDED.momentum_30d;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

-- 8. Score: artist_metrics → lead_scores (segments + formula, signals JSONB)
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
      + w3 * COALESCE(m.momentum_30d, 0) / 10.0
      + w4 * GREATEST(0, 1.0 - (CURRENT_DATE - m.last_seen)::NUMERIC / 30.0)
    )::NUMERIC(10,2),
    CASE
      WHEN m.first_seen >= CURRENT_DATE - 14 THEN 'NEW_ENTRY'
      WHEN COALESCE(m.total_days_in_charts, 0) >= 30 THEN 'CONSISTENT'
      WHEN COALESCE(m.momentum_7d, 0) > 0 THEN 'FAST_GROWING'
      WHEN COALESCE(m.momentum_7d, 0) < 0 THEN 'DECLINING'
      WHEN COALESCE(m.best_position, 99) <= 10 THEN 'TOP_PERFORMER'
      ELSE 'TOP_PERFORMER'
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
