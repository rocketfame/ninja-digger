-- Seed quality gate: track how many bio-emails each seed's followers yielded so
-- the harvester spends its 8 slots/run on seeds whose followers are artists with
-- contacts, not listeners. (Sep 4-6 2026: email yield fell from ~2000/day to 33
-- because the rotation reached low-quality seeds.)
ALTER TABLE sc_seed_accounts ADD COLUMN IF NOT EXISTS emails_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sc_seed_accounts ADD COLUMN IF NOT EXISTS quality_note TEXT;
CREATE INDEX IF NOT EXISTS idx_sc_artists_source_seed ON sc_artists (source_seed) WHERE source_seed IS NOT NULL;
-- One-off backfill from what is still in sc_artists (email rows are kept forever,
-- so this is a fair lower bound of each seed's historical yield).
UPDATE sc_seed_accounts s SET emails_found = GREATEST(s.emails_found, y.e)
  FROM (SELECT source_seed, COUNT(*) FILTER (WHERE email IS NOT NULL) e FROM sc_artists WHERE source_seed IS NOT NULL GROUP BY 1) y
 WHERE y.source_seed = s.permalink;
