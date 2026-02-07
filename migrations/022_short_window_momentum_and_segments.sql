-- Short-window support (5–7 days): momentum from actual data range; segment order so TOP/FAST/DECLINE/NEW/CONSISTENT all appear.

-- 1) Momentum relative to max(snapshot_date) in chart_entries so 5–7 days of data still yield momentum_7d
CREATE OR REPLACE FUNCTION refresh_artist_metrics()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  updated INT;
  ref_date DATE;
BEGIN
  SELECT MAX(snapshot_date) INTO ref_date FROM chart_entries;
  IF ref_date IS NULL THEN
    RETURN 0;
  END IF;

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
      (AVG(ce.position) FILTER (WHERE ce.snapshot_date >= ref_date - 6 AND ce.snapshot_date <= ref_date - 3)
       - AVG(ce.position) FILTER (WHERE ce.snapshot_date >= ref_date - 2 AND ce.snapshot_date <= ref_date))::NUMERIC AS momentum_7d,
      (AVG(ce.position) FILTER (WHERE ce.snapshot_date >= ref_date - 60 AND ce.snapshot_date < ref_date - 30)
       - AVG(ce.position) FILTER (WHERE ce.snapshot_date >= ref_date - 30 AND ce.snapshot_date <= ref_date))::NUMERIC AS momentum_30d
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

-- 2) Segment order for short window: TOP_PERFORMER → FAST_GROWING → DECLINING → NEW_ENTRY (≤3 days or very recent) → CONSISTENT
--    Score formula: same; NEW_ENTRY = total_days_in_charts <= 3 OR first_seen in last 5 days so short runs still get segments
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
