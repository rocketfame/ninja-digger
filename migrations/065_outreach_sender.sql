-- Track which Brevo account sent each email, for per-account daily capping and
-- reputation monitoring across the multi-account rotation.
ALTER TABLE outreach_events ADD COLUMN IF NOT EXISTS sender TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_sender_day ON outreach_events (sender, sent_at);
