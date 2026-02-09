-- Unique contact per artist+type+value to avoid duplicates from enrichment.
-- Allows multiple emails per artist (different values).

ALTER TABLE artist_contacts
  DROP CONSTRAINT IF EXISTS artist_contacts_artist_type_value_key;

-- Keep one row per (artist_beatport_id, type, value); remove duplicates by keeping id with max confidence.
DELETE FROM artist_contacts
WHERE id NOT IN (
  SELECT DISTINCT ON (artist_beatport_id, type, LOWER(TRIM(value))) id
  FROM artist_contacts
  ORDER BY artist_beatport_id, type, LOWER(TRIM(value)), confidence DESC NULLS LAST, created_at DESC
);

ALTER TABLE artist_contacts
  ADD CONSTRAINT artist_contacts_artist_type_value_key UNIQUE (artist_beatport_id, type, value);

COMMENT ON CONSTRAINT artist_contacts_artist_type_value_key ON artist_contacts IS 'One row per artist+type+value; enrichment upserts by this.';
