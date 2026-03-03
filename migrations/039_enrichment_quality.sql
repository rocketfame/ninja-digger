-- Enrichment quality: email classification, link validation, outreach events
-- Note: artist_contacts and artist_links already have confidence NUMERIC(3,2).
-- We add quality_score INT (0-100) for the new scale: >=80 send, 50-79 verify, <50 skip.

-- 1. artist_contacts: email_type, quality_score, verification_status, verified_at, source_context
ALTER TABLE artist_contacts
  ADD COLUMN IF NOT EXISTS email_type TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS quality_score INT DEFAULT 50,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_context TEXT;

-- 2. artist_links: quality_score, validated_at, validation_note
ALTER TABLE artist_links
  ADD COLUMN IF NOT EXISTS quality_score INT DEFAULT 50,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_note TEXT;

-- 3. outreach_events
CREATE TABLE IF NOT EXISTS outreach_events (
  id SERIAL PRIMARY KEY,
  artist_beatport_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_id TEXT,
  contact_value TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  outcome TEXT DEFAULT 'pending',
  notes TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_outreach_events_artist ON outreach_events (artist_beatport_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_outcome ON outreach_events (outcome);
CREATE INDEX IF NOT EXISTS idx_outreach_events_channel ON outreach_events (channel);
CREATE INDEX IF NOT EXISTS idx_outreach_events_sent_at ON outreach_events (sent_at DESC);
