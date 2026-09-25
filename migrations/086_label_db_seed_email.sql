-- A candidate found in our own lead base arrives with the address we already
-- had for that profile. It waits here and goes through the same filters in the
-- resolve step (bulk ingest cannot afford an MX lookup per row).
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS seed_email TEXT;
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS seed_email_src TEXT;
