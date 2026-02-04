-- Ninja Digger — Phase 3: Normalization (Source-Agnostic)
-- One logical artist = one ID. Source data preserved. Run after 004.

-- 1. normalized_name для зіставлення (однакова назва з різних джерел → один артист/лейбл)
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

ALTER TABLE labels
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

-- Backfill: normalized_name = lower(trim(name)), collapse spaces
UPDATE artists
SET normalized_name = regexp_replace(lower(trim(name)), '\s+', ' ', 'g')
WHERE normalized_name IS NULL;

UPDATE labels
SET normalized_name = regexp_replace(lower(trim(name)), '\s+', ' ', 'g')
WHERE normalized_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_artists_normalized_name ON artists(normalized_name);
CREATE INDEX IF NOT EXISTS idx_labels_normalized_name ON labels(normalized_name);

COMMENT ON COLUMN artists.normalized_name IS 'Normalized name for matching across sources (lowercase, trimmed, collapsed spaces)';
COMMENT ON COLUMN labels.normalized_name IS 'Normalized name for matching across sources';

-- 2. artist_sources — зв’язок нормалізованого артиста з джерелом і raw-назвою
CREATE TABLE IF NOT EXISTS artist_sources (
  id          SERIAL PRIMARY KEY,
  artist_id   INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  source_id   INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  raw_name    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, raw_name)
);

CREATE INDEX IF NOT EXISTS idx_artist_sources_artist_id ON artist_sources(artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_sources_source_id ON artist_sources(source_id);

COMMENT ON TABLE artist_sources IS 'Source-aware: which raw name from which source maps to one artist_id';

-- 3. label_sources — зв’язок нормалізованого лейбла з джерелом і raw-назвою
CREATE TABLE IF NOT EXISTS label_sources (
  id          SERIAL PRIMARY KEY,
  label_id    INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  source_id   INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  raw_name    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, raw_name)
);

CREATE INDEX IF NOT EXISTS idx_label_sources_label_id ON label_sources(label_id);
CREATE INDEX IF NOT EXISTS idx_label_sources_source_id ON label_sources(source_id);

COMMENT ON TABLE label_sources IS 'Source-aware: which raw name from which source maps to one label_id';
