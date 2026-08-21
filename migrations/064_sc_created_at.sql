-- True "first seen" timestamp so we can count NEW SoundCloud leads per hour
-- (harvested_at gets bumped on re-harvest, so it overcounts). Set only on
-- insert; backfilled from harvested_at for existing rows.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE sc_artists SET created_at = COALESCE(harvested_at, updated_at) WHERE created_at IS NULL;
