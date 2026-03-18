-- RA Events and Promoter Groups schema
-- Parallel to Beatport leads pipeline but for RA event promoters

-- Promoter groups (organizers of events)
CREATE TABLE IF NOT EXISTS ra_promoters (
  id SERIAL PRIMARY KEY,
  ra_id TEXT UNIQUE, -- RA's internal promoter ID from URL
  name TEXT NOT NULL,
  ra_url TEXT,
  website TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  follower_count INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Events scraped from RA
CREATE TABLE IF NOT EXISTS ra_events (
  id SERIAL PRIMARY KEY,
  ra_event_id TEXT UNIQUE, -- RA's internal event ID
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  venue_name TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  ra_url TEXT,
  promoter_id INT REFERENCES ra_promoters(id),
  lineup TEXT, -- comma-separated artist names
  scraped_at TIMESTAMPTZ DEFAULT now()
);

-- Promoter contacts (emails, social links)
CREATE TABLE IF NOT EXISTS ra_promoter_contacts (
  id SERIAL PRIMARY KEY,
  promoter_id INT REFERENCES ra_promoters(id),
  type TEXT NOT NULL, -- 'email', 'instagram', 'facebook', 'website', 'soundcloud'
  value TEXT NOT NULL,
  source_url TEXT,
  confidence NUMERIC(3,2) DEFAULT 0.50,
  status TEXT DEFAULT 'ok', -- 'ok', 'bounced', 'invalid'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(promoter_id, type, value)
);

-- Promoter lead profiles (outreach status)
CREATE TABLE IF NOT EXISTS ra_promoter_profiles (
  promoter_id INT PRIMARY KEY REFERENCES ra_promoters(id),
  status TEXT DEFAULT 'New', -- New, Attempt 1, Attempt 2, No Response, Cold, Hot, Bounced
  segment TEXT, -- '1_week', '2_weeks', '3_weeks', '4_weeks', '5_weeks', '6_weeks'
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ra_events_date ON ra_events(event_date);
CREATE INDEX IF NOT EXISTS idx_ra_events_promoter ON ra_events(promoter_id);
CREATE INDEX IF NOT EXISTS idx_ra_promoters_city ON ra_promoters(city);
CREATE INDEX IF NOT EXISTS idx_ra_promoter_contacts_type ON ra_promoter_contacts(type);
