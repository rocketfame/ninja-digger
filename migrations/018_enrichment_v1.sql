-- Enrichment v1: artist_links, artist_contacts, enrichment_runs, url_cache.
-- Keys by artist_beatport_id (v2).

CREATE TABLE IF NOT EXISTS artist_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_beatport_id TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.5,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_beatport_id, type)
);

CREATE INDEX IF NOT EXISTS idx_artist_links_artist ON artist_links(artist_beatport_id);
CREATE INDEX IF NOT EXISTS idx_artist_links_type ON artist_links(type);

COMMENT ON TABLE artist_links IS 'v2: discovered links (instagram, soundcloud, linktree, etc.) per artist';

CREATE TABLE IF NOT EXISTS artist_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_beatport_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'email',
  value TEXT NOT NULL,
  source_url TEXT,
  confidence NUMERIC(3,2) DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artist_contacts_artist ON artist_contacts(artist_beatport_id);

COMMENT ON TABLE artist_contacts IS 'v2: public contacts (email, booking) from bio/links';

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  scope_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enrichment_runs_scope_check CHECK (scope IN ('artist', 'segment')),
  CONSTRAINT enrichment_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_scope ON enrichment_runs(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_status ON enrichment_runs(status);

COMMENT ON TABLE enrichment_runs IS 'v2: enrichment job tracking';

CREATE TABLE IF NOT EXISTS url_cache (
  url TEXT PRIMARY KEY,
  body TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_seconds INTEGER DEFAULT 86400
);

CREATE INDEX IF NOT EXISTS idx_url_cache_fetched ON url_cache(fetched_at);

COMMENT ON TABLE url_cache IS 'v2: cache fetched URLs to avoid re-fetch within TTL';
