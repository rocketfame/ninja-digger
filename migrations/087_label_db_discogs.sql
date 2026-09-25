-- Discogs enrichment (country from the label's contact block, parent/sub-labels,
-- site links) and the blacklist source (not-ICP addresses = labels/agencies the
-- artist barrels skipped). `kind` separates labels from booking/management
-- agencies found on the same shared domains.
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS discogs_id INT;
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS discogs_at TIMESTAMPTZ;
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS parent_label TEXT;
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS sublabels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE label_db ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'label';  -- label | agency
