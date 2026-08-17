-- P0 fix: lead_profiles CHECK constraint (from migration 017) only allowed
-- New/Contacted/In Progress/Won/Lost, but the outreach + inbox code writes
-- 'Attempt 1'/'Attempt 2'/'No Response'/'Responded'/'Not Interested'/'Cold'/
-- 'Blacklist'. Every status write threw and was swallowed, so leads were stuck
-- at 'New' (re-contacted forever, no follow-ups, sends uncounted). Relax it to
-- the full state machine the code actually uses.
ALTER TABLE lead_profiles DROP CONSTRAINT IF EXISTS lead_profiles_status_check;
ALTER TABLE lead_profiles ADD CONSTRAINT lead_profiles_status_check CHECK (
  status IN (
    'New', 'Contacted', 'In Progress', 'Won', 'Lost',
    'Attempt 1', 'Attempt 2', 'No Response', 'Responded', 'Not Interested', 'Cold', 'Blacklist'
  )
);

-- Enrichment cycling fix: enrichScBatch ordered by a fixed key, so it re-probed
-- the same dry profiles every hour and never advanced. Track attempts so we
-- cycle least-recently-tried first.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS enrich_attempted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sc_artists_enrich_attempt
  ON sc_artists (enrich_attempted_at NULLS FIRST) WHERE email IS NULL;

-- Retention support: prune old outreach_events (audit log, not needed forever).
CREATE INDEX IF NOT EXISTS idx_outreach_events_sent_at ON outreach_events (sent_at);
