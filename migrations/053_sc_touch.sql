-- Track which touch of the SC outreach sequence a lead has received.
-- 0 = not contacted, 1 = opener sent, 2 = value follow-up sent, 3 = offer sent.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS sc_touch INT NOT NULL DEFAULT 0;
