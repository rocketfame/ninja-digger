-- Segments: first-class object for Oracle Mode and saved lists.
-- source_type: beatport (discovery) | oracle (one-off scan) | manual.

CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'oracle',
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT segments_source_type_check CHECK (
    source_type IN ('beatport', 'oracle', 'manual')
  )
);

CREATE INDEX IF NOT EXISTS idx_segments_source_type ON segments(source_type);
CREATE INDEX IF NOT EXISTS idx_segments_created_at ON segments(created_at DESC);

COMMENT ON TABLE segments IS 'v2: named segment (Oracle scan, discovery, or manual); links to segment_artists';

-- Junction: which artists belong to which segment (Beatport key).
CREATE TABLE IF NOT EXISTS segment_artists (
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  artist_beatport_id TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, artist_beatport_id)
);

CREATE INDEX IF NOT EXISTS idx_segment_artists_artist ON segment_artists(artist_beatport_id);

COMMENT ON TABLE segment_artists IS 'v2: artists in a segment; used for enrichment and comparison';
