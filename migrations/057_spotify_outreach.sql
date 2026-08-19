-- Spotify-channel outreach + engagement, mirroring the SoundCloud framework.
-- sp_touch = last touch sent (0=none,1,2,3); lead_status drives the sequence
-- (New/Contacted → Responded/Bounced/Unsubscribed/No Response stop it).
ALTER TABLE spotify_leads
  ADD COLUMN IF NOT EXISTS sp_touch INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_status TEXT,          -- delivered/engaged/bounced/unsub
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_open_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicks INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_spotify_leads_outreach
  ON spotify_leads (sp_touch, lead_status) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spotify_leads_engagement
  ON spotify_leads (opens DESC, delivered_at) WHERE email IS NOT NULL;
