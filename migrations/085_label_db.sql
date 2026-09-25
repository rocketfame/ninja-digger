-- Record-label database: our own, built from sources we already work with
-- (Beatport charts via BPTT, SoundCloud) and the labels' own public pages.
-- Separate from the legacy `labels` table, which only ever held chart names.
CREATE TABLE IF NOT EXISTS label_db (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  norm_name       TEXT NOT NULL UNIQUE,
  genres          TEXT[] NOT NULL DEFAULT '{}',   -- raw: BPTT slugs, SoundCloud genre tags
  genre_groups    TEXT[] NOT NULL DEFAULT '{}',   -- ~15 main groups, what the UI filters on
  discovered_via  TEXT NOT NULL DEFAULT 'charts',   -- charts | sc_graph | …
  -- chart activity (last 31 days of BPTT)
  chart_entries   INT NOT NULL DEFAULT 0,
  chart_tracks    INT NOT NULL DEFAULT 0,
  best_position   INT,
  last_charted    DATE,
  -- SoundCloud profile
  sc_id           BIGINT,
  sc_permalink    TEXT,
  sc_followers    INT,
  sc_tracks       INT,
  sc_verified     BOOLEAN,
  sc_last_active  TIMESTAMPTZ,
  description     TEXT,
  -- presence
  country_code    TEXT,
  country_tier    SMALLINT,          -- 1..3, NULL = unknown
  city            TEXT,
  website         TEXT,
  instagram       TEXT,
  facebook        TEXT,
  bandcamp        TEXT,
  youtube         TEXT,
  twitter         TEXT,
  beatport_url    TEXT,
  -- demo policy
  demo_policy     TEXT,              -- email | form | closed | unknown
  demo_url        TEXT,
  -- pipeline state
  status          TEXT NOT NULL DEFAULT 'new',  -- new | resolved | no_match | excluded
  exclude_reason  TEXT,
  grade           TEXT,              -- A | B | C
  resolved_at     TIMESTAMPTZ,
  crawled_at      TIMESTAMPTZ,
  graph_at        TIMESTAMPTZ,       -- its SC followings walked for sister labels
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_label_db_status ON label_db (status);
CREATE INDEX IF NOT EXISTS idx_label_db_groups ON label_db USING GIN (genre_groups);

-- Every address we found for a label, with where we found it (provenance is
-- the spam-trap defence: only addresses the label publishes itself) and the
-- verdict of each filter layer.
CREATE TABLE IF NOT EXISTS label_db_emails (
  label_id      INT NOT NULL REFERENCES label_db(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'general',  -- demo | promo | info | booking | press | general
  source_url    TEXT,
  verdict       TEXT NOT NULL DEFAULT 'pending',  -- pending (awaits SMTP) | valid | catch_all | unknown | invalid
  reject_reason TEXT,
  found_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at    TIMESTAMPTZ,
  PRIMARY KEY (label_id, email)
);
CREATE INDEX IF NOT EXISTS idx_label_db_emails_verdict ON label_db_emails (verdict);
