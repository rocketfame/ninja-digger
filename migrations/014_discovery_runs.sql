-- discovery_runs: persist run status for UI (Run Discovery button, live progress).
CREATE TABLE IF NOT EXISTS discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
  stage TEXT,
  progress TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  charts_count INT,
  artists_count INT,
  leads_count INT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_started ON discovery_runs(started_at DESC);

COMMENT ON TABLE discovery_runs IS 'UI: manual Run Discovery progress; poll for live status';
