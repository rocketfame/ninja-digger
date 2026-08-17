-- Daily snapshot of RepostExchange active-campaign volume (market pulse)
CREATE TABLE IF NOT EXISTS reex_daily (
  day DATE PRIMARY KEY,
  active_campaigns INT NOT NULL,
  submitters_ingested INT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ DEFAULT now()
);
