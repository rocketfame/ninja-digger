-- Liveness signals for SoundCloud leads: separate "has tracks" from "actually
-- active". A gem must be posting content, not a dormant account or bot.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS last_track_at TIMESTAMPTZ;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sc_artists_active ON sc_artists(is_active) WHERE is_active = true;
