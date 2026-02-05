-- Segment notes + segment_items for full preview (artist, track, rank, raw_json).
-- source-aware; raw_json for future improvements.

ALTER TABLE segments ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS segment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  artist_beatport_id TEXT,
  artist_name TEXT NOT NULL,
  artist_url TEXT,
  track_name TEXT,
  track_url TEXT,
  rank INTEGER,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segment_items_segment ON segment_items(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_items_artist ON segment_items(artist_beatport_id);

COMMENT ON TABLE segment_items IS 'v2: one row per chart item (artist+track); full preview and provenance';
