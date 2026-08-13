-- Fix migration 034 loophole: dedup was done on LOWER(TRIM(value)) but the unique
-- constraint was created on raw value, allowing case/whitespace duplicates.
-- Replace with a unique index on the normalized form.

-- Remove duplicates that differ only by case/whitespace (keep highest confidence)
DELETE FROM artist_contacts
WHERE id NOT IN (
  SELECT DISTINCT ON (artist_beatport_id, type, LOWER(TRIM(value))) id
  FROM artist_contacts
  ORDER BY artist_beatport_id, type, LOWER(TRIM(value)), confidence DESC NULLS LAST, id
);

ALTER TABLE artist_contacts
  DROP CONSTRAINT IF EXISTS artist_contacts_artist_type_value_key;

CREATE UNIQUE INDEX IF NOT EXISTS artist_contacts_artist_type_value_norm_key
  ON artist_contacts (artist_beatport_id, type, LOWER(TRIM(value)));

-- Document all valid contact statuses used across the codebase
ALTER TABLE artist_contacts DROP CONSTRAINT IF EXISTS artist_contacts_status_check;
ALTER TABLE artist_contacts
  ADD CONSTRAINT artist_contacts_status_check
  CHECK (status IN ('ok', 'flagged', 'blocked', 'bounced'));
