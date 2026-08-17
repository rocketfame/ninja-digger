-- Re-Ex promoters are ingested without track_count (defaults to 0) and forced
-- to tier A. Many are repost/promo channels with NO tracks of their own — junk
-- for artist outreach. We fetch their real profile so repost-channels (0 own
-- tracks) can be told apart from real artists, and recompute their tier.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS profile_refreshed_at TIMESTAMPTZ;

-- Index for the "leads with their own tracks" filter used across the UI/export.
CREATE INDEX IF NOT EXISTS idx_sc_artists_has_tracks
  ON sc_artists (track_count) WHERE track_count >= 1;
