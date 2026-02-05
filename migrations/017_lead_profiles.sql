-- Lead profiles: status + notes per artist (v2 key = artist_beatport_id).

CREATE TABLE IF NOT EXISTS lead_profiles (
  artist_beatport_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_profiles_status_check CHECK (
    status IN ('New', 'Contacted', 'In Progress', 'Won', 'Lost')
  )
);

CREATE INDEX IF NOT EXISTS idx_lead_profiles_status ON lead_profiles(status);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_updated ON lead_profiles(updated_at DESC);

COMMENT ON TABLE lead_profiles IS 'v2: outreach status and internal notes per lead (artist_beatport_id)';
