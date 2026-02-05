-- BP Top Tracker: daily chart snapshots (retrospective data).
-- One row per (snapshot_date, genre_slug, position). Used for backfill + daily update.

CREATE TABLE IF NOT EXISTS bptoptracker_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  genre_slug TEXT NOT NULL,
  position INTEGER NOT NULL,
  track_title TEXT,
  artist_name TEXT NOT NULL,
  artists_full TEXT,
  label_name TEXT,
  released TEXT,
  movement TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, genre_slug, position)
);

CREATE INDEX IF NOT EXISTS idx_bptoptracker_daily_date_genre ON bptoptracker_daily(snapshot_date, genre_slug);
CREATE INDEX IF NOT EXISTS idx_bptoptracker_daily_artist ON bptoptracker_daily(artist_name);
CREATE INDEX IF NOT EXISTS idx_bptoptracker_daily_snapshot ON bptoptracker_daily(snapshot_date DESC);

COMMENT ON TABLE bptoptracker_daily IS 'BP Top Tracker daily chart snapshots; backfill 2-3 months, then daily update';
