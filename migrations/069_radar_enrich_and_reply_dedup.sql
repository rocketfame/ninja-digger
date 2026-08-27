-- #1 Server-side link enrichment: mark when we last fetched a lead's links so
-- we don't re-crawl the same page every run.
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS link_checked_at timestamptz;

-- #2 Per-inbound-message dedup so EVERY reply (not just the first) surfaces to
-- Telegram exactly once, even though inbox re-scans the last 3 days each run.
CREATE TABLE IF NOT EXISTS notified_replies (
  message_id text PRIMARY KEY,
  notified_at timestamptz NOT NULL DEFAULT now()
);
