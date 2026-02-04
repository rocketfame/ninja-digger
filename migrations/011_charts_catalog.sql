-- charts_catalog: каталог чартів для discovery (url унікальний, last_seen_at оновлюється при discovery)
-- Якщо чарт зник — is_active=false (наприклад після порогу по last_seen_at).

CREATE TABLE IF NOT EXISTS charts_catalog (
  id SERIAL PRIMARY KEY,

  source TEXT NOT NULL DEFAULT 'beatport',
  url TEXT NOT NULL UNIQUE,

  chart_scope TEXT NOT NULL DEFAULT 'genre',
  chart_family TEXT NOT NULL,

  genre_slug TEXT,
  genre_name TEXT,

  title TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,

  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  http_status INT,
  parse_version TEXT NOT NULL DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_charts_catalog_source_family
  ON charts_catalog (source, chart_family);

CREATE INDEX IF NOT EXISTS idx_charts_catalog_active
  ON charts_catalog (is_active);

CREATE INDEX IF NOT EXISTS idx_charts_catalog_genre
  ON charts_catalog (genre_slug);

COMMENT ON TABLE charts_catalog IS 'Discovery: which chart URLs exist; last_seen_at updated on each run';
