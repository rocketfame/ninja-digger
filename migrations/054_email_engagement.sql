-- Email engagement tracking (Brevo webhook feeds this). The "gold" base is
-- scored from these: replied > opened > delivered(no bounce) > dead.
ALTER TABLE sc_artists
  ADD COLUMN IF NOT EXISTS email_status TEXT,          -- unknown/valid/delivered/alive/engaged/bounced/unsub
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_open_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicks INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sc_artists_engagement ON sc_artists (opens DESC, delivered_at) WHERE email IS NOT NULL;

-- Raw event log (audit + dedup), keyed by email so it serves BP + SC.
CREATE TABLE IF NOT EXISTS email_events (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  event TEXT NOT NULL,          -- delivered/opened/click/hard_bounce/soft_bounce/blocked/unsubscribed/spam
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events (email, event);
