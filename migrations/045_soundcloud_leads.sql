-- SoundCloud lead generation: harvest followers of seed accounts (organic
-- followers = musicians who self-promote). Separate pipeline from Beatport.

-- Seed accounts whose followers we harvest
CREATE TABLE IF NOT EXISTS sc_seed_accounts (
  id SERIAL PRIMARY KEY,
  permalink TEXT NOT NULL UNIQUE,          -- e.g. "rcktfm"
  soundcloud_id BIGINT,
  username TEXT,
  followers_count INT,
  last_harvested_at TIMESTAMPTZ,
  cursor TEXT,                              -- next_href for resumable pagination
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Harvested artists (one per SoundCloud user)
CREATE TABLE IF NOT EXISTS sc_artists (
  soundcloud_id BIGINT PRIMARY KEY,
  permalink TEXT,
  permalink_url TEXT,
  username TEXT,
  full_name TEXT,
  city TEXT,
  country_code TEXT,
  description TEXT,
  avatar_url TEXT,
  track_count INT DEFAULT 0,
  followers_count INT DEFAULT 0,
  followings_count INT DEFAULT 0,
  likes_count INT DEFAULT 0,
  reposts_count INT DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  sc_created_at TIMESTAMPTZ,               -- account age
  last_modified TIMESTAMPTZ,               -- recent activity signal
  email TEXT,                              -- extracted from description/links
  email_source TEXT,                       -- 'bio' | 'linktree' | 'enrich'
  tier TEXT,                               -- A/B/C, computed on scoring
  lead_status TEXT NOT NULL DEFAULT 'New', -- New/Attempt 1/2/No Response/Responded/In Progress/Won/Not Interested
  source_seed TEXT,                        -- which seed account they followed
  harvested_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_artists_status ON sc_artists(lead_status);
CREATE INDEX IF NOT EXISTS idx_sc_artists_tier ON sc_artists(tier);
CREATE INDEX IF NOT EXISTS idx_sc_artists_email ON sc_artists(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sc_artists_harvested ON sc_artists(harvested_at DESC);

-- Seed the first account
INSERT INTO sc_seed_accounts (permalink) VALUES ('rcktfm') ON CONFLICT (permalink) DO NOTHING;
