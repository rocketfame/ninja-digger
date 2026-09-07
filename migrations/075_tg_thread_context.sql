-- Keep the conversation: what the lead wrote (excerpt) and what we actually sent
-- (sent_reply), so the next draft sees the whole thread instead of one sentence.
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS excerpt TEXT;
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS sent_reply TEXT;
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tg_notifications_email_created ON tg_notifications (LOWER(email), created_at DESC);
