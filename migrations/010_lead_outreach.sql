-- Ninja Digger — Phase 7: Outreach Support (Manual-First)
-- Status, contact fields, readiness. No auto-messages.

CREATE TABLE IF NOT EXISTS lead_outreach (
  artist_id      INT PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'not_started',
  contact_email  TEXT,
  contact_other  TEXT,
  readiness      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_outreach_status_check CHECK (
    status IN ('not_started', 'contacted', 'replied', 'declined', 'converted')
  )
);

CREATE INDEX IF NOT EXISTS idx_lead_outreach_status ON lead_outreach(status);
CREATE INDEX IF NOT EXISTS idx_lead_outreach_readiness ON lead_outreach(readiness);

COMMENT ON TABLE lead_outreach IS 'Phase 7: manual outreach tracking; no auto-DM/email';
