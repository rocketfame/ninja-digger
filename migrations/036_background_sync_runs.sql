-- Throttle for background BPTT sync: avoid running on every page load.
CREATE TABLE IF NOT EXISTS background_sync_runs (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'bptoptracker',
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_background_sync_runs_scope_ran
  ON background_sync_runs (scope, ran_at DESC);

COMMENT ON TABLE background_sync_runs IS 'Last run time per scope for background sync throttle (e.g. BPTT on app load).';
