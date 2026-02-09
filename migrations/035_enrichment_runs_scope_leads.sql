-- Allow scope = 'leads' for enrichment runs triggered from leads filter (segment/genre/dates).
ALTER TABLE enrichment_runs DROP CONSTRAINT IF EXISTS enrichment_runs_scope_check;
ALTER TABLE enrichment_runs ADD CONSTRAINT enrichment_runs_scope_check CHECK (scope IN ('artist', 'segment', 'leads'));
