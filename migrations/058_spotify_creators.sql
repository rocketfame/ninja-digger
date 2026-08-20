-- Creator-discovery graph: Instagram accounts similar to its21master (Spotify-promo
-- marketers whose comment sections are full of artist leads). Seeded via IG's
-- discover/chaining ("related accounts") and scored by bio/category relevance.
-- Approved creators feed the commenter parser → new Spotify leads.
CREATE TABLE IF NOT EXISTS spotify_creators (
  ig_username TEXT PRIMARY KEY,
  ig_id TEXT,
  full_name TEXT,
  followers INT,
  bio TEXT,
  category TEXT,                 -- IG business category if any
  score INT NOT NULL DEFAULT 0,  -- relevance as a lead-source seed
  status TEXT NOT NULL DEFAULT 'candidate', -- candidate | approved | parsed | skipped
  discovered_from TEXT,          -- seed username this was chained from
  leads_found INT NOT NULL DEFAULT 0,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spotify_creators_status ON spotify_creators (status, score DESC);

-- Seed the origin creator as already-parsed so the graph has a root.
INSERT INTO spotify_creators (ig_username, ig_id, full_name, status, score, discovered_from)
VALUES ('its21master', '4138592077', 'its21master', 'parsed', 100, 'seed')
ON CONFLICT (ig_username) DO NOTHING;
