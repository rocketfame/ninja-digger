-- The mass channel as a state machine, one row per group the cycle created.
-- The hourly cron advances each group through: filled → broadcast → delivered
-- → deleted. Nothing is ever deleted before eSputnik has reported delivery.
CREATE TABLE IF NOT EXISTS mass_groups (
  group_id        BIGINT PRIMARY KEY,          -- eSputnik group id
  group_name      TEXT NOT NULL,
  platform        TEXT NOT NULL,
  cycle           INT NOT NULL,                -- N-th cycle of the day
  day             DATE NOT NULL,
  members         INT NOT NULL DEFAULT 0,      -- what landed in the group
  broadcast_id    BIGINT,                      -- set once the campaign is scheduled
  message_id      BIGINT,                      -- eSputnik message used
  scheduled_at    TIMESTAMPTZ,
  delivered       INT NOT NULL DEFAULT 0,      -- delivered events seen for this group
  deleted_at      TIMESTAMPTZ,                 -- contacts removed from eSputnik
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mass_groups_open ON mass_groups (deleted_at) WHERE deleted_at IS NULL;

-- Segment after the touch. Recomputed hourly from email_events:
--   hot = clicked, warm = opened, cold = delivered but no open,
--   blacklist = bounce / complaint / unsubscribe (also in email_blacklist).
ALTER TABLE lead_exports ADD COLUMN IF NOT EXISTS segment TEXT;
CREATE INDEX IF NOT EXISTS idx_lead_exports_segment ON lead_exports (segment);
