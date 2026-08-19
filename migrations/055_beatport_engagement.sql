-- Mirror the SoundCloud engagement funnel onto Beatport contacts so Brevo
-- opens/delivered/bounces feed a real "gold" (verified-alive) base here too.
ALTER TABLE artist_contacts
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_open_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_artist_contacts_engagement ON artist_contacts (opens DESC) WHERE type='email';
