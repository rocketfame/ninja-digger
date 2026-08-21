-- Track when an email was first discovered, so the hourly report counts ALL
-- emails found (bio-at-harvest is the main SC source and was being missed —
-- the report only looked at enrich_attempted_at and showed misleadingly low
-- numbers). Backfilled from harvested_at / enriched_at.
ALTER TABLE sc_artists   ADD COLUMN IF NOT EXISTS email_found_at timestamptz;
ALTER TABLE spotify_leads ADD COLUMN IF NOT EXISTS email_found_at timestamptz;
UPDATE sc_artists   SET email_found_at = COALESCE(harvested_at, updated_at) WHERE email IS NOT NULL AND email_found_at IS NULL;
UPDATE spotify_leads SET email_found_at = COALESCE(enriched_at, updated_at) WHERE email IS NOT NULL AND email_found_at IS NULL;
