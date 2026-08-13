-- Telegram notification → lead mapping.
-- When the bot notifies about a lead reply, we store which TG message maps to
-- which artist/email so a Telegram swipe-reply can be routed back as an email.
CREATE TABLE IF NOT EXISTS tg_notifications (
  id SERIAL PRIMARY KEY,
  tg_message_id BIGINT NOT NULL UNIQUE,
  artist_beatport_id TEXT NOT NULL,
  artist_name TEXT,
  email TEXT NOT NULL,
  subject TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_notifications_msg ON tg_notifications(tg_message_id);
