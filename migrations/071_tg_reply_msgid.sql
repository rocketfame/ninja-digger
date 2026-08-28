-- Store the inbound reply's Message-ID so the "Ignore" button can mark that
-- exact email as read (\Seen) in Gmail.
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS reply_msgid text;
