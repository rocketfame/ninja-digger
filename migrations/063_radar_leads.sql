-- "Radar" — hot-lead discovery hub, unified across sources (instagram / reddit /
-- youtube / playlisting). Kept SEPARATE from spotify_leads so the multi-source
-- flow doesn't get confused with the IG-comment pipeline.
CREATE TABLE IF NOT EXISTS radar_leads (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT NOT NULL,              -- instagram | reddit | youtube | playlisting
  handle         TEXT NOT NULL,              -- source-native identifier
  name           TEXT,
  spotify_url    TEXT,
  soundcloud_url TEXT,
  website        TEXT,
  email          TEXT,
  email_source   TEXT,
  followers      INTEGER,
  monthly_listeners INTEGER,
  release_date   DATE,
  intent_signal  TEXT,                       -- what made it "hot" (post title, "paid submission"...)
  source_url     TEXT,                       -- link back to the post/video/profile
  heat_score     INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'new',         -- new | queued | contacted | responded | dead
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  enriched_at    TIMESTAMPTZ,
  email_found_at TIMESTAMPTZ,
  UNIQUE (source, handle)
);
CREATE INDEX IF NOT EXISTS idx_radar_heat   ON radar_leads (heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_radar_source ON radar_leads (source);
CREATE INDEX IF NOT EXISTS idx_radar_email  ON radar_leads (email) WHERE email IS NOT NULL;
