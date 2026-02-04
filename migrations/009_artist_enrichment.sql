-- Ninja Digger — Phase 6: Enrichment (stored separately, optional)
-- No dependency on segmentation. Core system works without it.

CREATE TABLE IF NOT EXISTS artist_enrichment (
  artist_id    INT PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
  bio_summary  TEXT,
  role         TEXT,
  insight      TEXT,
  enriched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artist_enrichment_enriched_at ON artist_enrichment(enriched_at);

COMMENT ON TABLE artist_enrichment IS 'Phase 6: optional bio/role/insight; does not affect segmentation';
