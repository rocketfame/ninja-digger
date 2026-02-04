-- Ninja Digger — жанр/жанри по артисту
-- Запускати після 002_seed.sql

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS genres TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN artists.genres IS 'Жанр або жанри артиста (наприклад: Techno, House).';

CREATE INDEX IF NOT EXISTS idx_artists_genres ON artists USING GIN (genres);

-- Приклад для seed-артистів: один жанр і кілька жанрів
UPDATE artists SET genres = ARRAY['Techno']           WHERE name = 'Test Artist One';
UPDATE artists SET genres = ARRAY['House', 'Tech House'] WHERE name = 'Test Artist Two';
