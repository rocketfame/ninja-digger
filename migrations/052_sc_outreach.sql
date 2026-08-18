-- SoundCloud cold-outreach tracking. lead_status already exists on sc_artists;
-- we use it as the state machine: NULL/'New' = not contacted, 'Contacted',
-- 'Responded', 'Bounced', 'Unsubscribed'. contacted_at drives follow-up timing
-- and the daily ramp accounting. The steady-state prune keeps email leads
-- forever, so contacted leads are never dropped.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sc_artists_outreach
  ON sc_artists (contacted_at, lead_status)
  WHERE email IS NOT NULL;
