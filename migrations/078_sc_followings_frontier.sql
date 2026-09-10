-- Graph discovery frontier. A producer's FOLLOWINGS are 90% producers and half
-- of them carry a booking email in the bio; their followers are mostly
-- listeners. So the crawl walks the outgoing edge, and every producer we find
-- becomes a new expansion point. The frontier lives on sc_artists rather than
-- in its own table: "not yet expanded" is a property of the artist, and a
-- second table would be a second identity to keep in sync.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS followings_crawled_at TIMESTAMPTZ;

-- The frontier query: unexpanded producers, best first.
CREATE INDEX IF NOT EXISTS idx_sc_frontier ON sc_artists (track_count DESC)
  WHERE followings_crawled_at IS NULL AND track_count >= 3;
