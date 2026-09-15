-- The Ignore button in the bot is a decision about the person, not just the
-- draft: record it so the lead base can treat ignored responders as cold.
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;
-- Backfill: a notification with no draft and no sent reply was ignored.
UPDATE tg_notifications SET ignored_at = COALESCE(sent_at, created_at) WHERE ignored_at IS NULL AND draft IS NULL AND sent_reply IS NULL;
