-- Manual link: bptoptracker artist_name -> lead (artist_beatport_id).
-- Used when auto-match by name fails or for disambiguation.

CREATE TABLE IF NOT EXISTS bptoptracker_artist_links (
  artist_name TEXT PRIMARY KEY,
  artist_beatport_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bptoptracker_artist_links_bp_id ON bptoptracker_artist_links(artist_beatport_id);

COMMENT ON TABLE bptoptracker_artist_links IS 'Manual mapping bptoptracker artist_name -> lead (artist_beatport_id)';
