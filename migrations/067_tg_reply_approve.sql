-- Approve/edit-in-Telegram flow: store the LLM draft + source with each reply
-- notification so an Approve button can send it, and swipe-reply can edit it.
ALTER TABLE tg_notifications ALTER COLUMN artist_beatport_id DROP NOT NULL;
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS draft TEXT;
ALTER TABLE tg_notifications ADD COLUMN IF NOT EXISTS source TEXT;
