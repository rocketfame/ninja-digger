-- Ninja Digger — Phase 1: Initial schema
-- Source of truth. Run migrations in order.

-- 1. sources — джерела даних (наприклад Songstats)
CREATE TABLE IF NOT EXISTS sources (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. artists — артисти / DJ
CREATE TABLE IF NOT EXISTS artists (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. labels — лейбли
CREATE TABLE IF NOT EXISTS labels (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. tracks — треки (зв’язок artist + label)
CREATE TABLE IF NOT EXISTS tracks (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  artist_id  INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  label_id   INT REFERENCES labels(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_label_id  ON tracks(label_id);

-- 5. chart_entries — записи в чартах (одне джерело, одна дата, позиція, трек)
CREATE TABLE IF NOT EXISTS chart_entries (
  id         SERIAL PRIMARY KEY,
  source_id  INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  track_id   INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position   INT NOT NULL,
  chart_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, chart_date, position)
);

CREATE INDEX IF NOT EXISTS idx_chart_entries_source_date ON chart_entries(source_id, chart_date);
CREATE INDEX IF NOT EXISTS idx_chart_entries_track_id    ON chart_entries(track_id);

-- 6. lead_scores — оцінка/сегмент артиста (Фаза 4 заповнюватиме)
CREATE TABLE IF NOT EXISTS lead_scores (
  id          SERIAL PRIMARY KEY,
  artist_id   INT NOT NULL UNIQUE REFERENCES artists(id) ON DELETE CASCADE,
  score       NUMERIC NOT NULL,
  segment     TEXT NOT NULL CHECK (segment IN ('core', 'regular', 'fresh', 'momentum', 'flyers')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_artist_id ON lead_scores(artist_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_segment  ON lead_scores(segment);

-- 7. artist_notes — ручні нотатки по артисту
CREATE TABLE IF NOT EXISTS artist_notes (
  id         SERIAL PRIMARY KEY,
  artist_id  INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artist_notes_artist_id ON artist_notes(artist_id);
