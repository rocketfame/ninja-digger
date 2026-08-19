-- Spotify lead-gen: people who comment under Instagram Reels of Spotify-promo
-- marketers (hot leads — they showed buying intent). We harvest the commenters
-- and enrich their public funnel (Spotify/SoundCloud/Linktree/email).
CREATE TABLE IF NOT EXISTS spotify_leads (
  id BIGSERIAL PRIMARY KEY,
  ig_username TEXT NOT NULL UNIQUE,
  full_name TEXT,
  source_post TEXT,               -- IG post/reel URL they commented under
  comment_text TEXT,
  bio TEXT,
  followers INT,
  email TEXT,
  email_source TEXT,
  spotify_url TEXT,
  soundcloud_url TEXT,
  website TEXT,
  linktree TEXT,
  enriched_at TIMESTAMPTZ,
  lead_status TEXT,               -- New/Contacted/Responded/Bounced/Unsubscribed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spotify_leads_email ON spotify_leads (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spotify_leads_enrich ON spotify_leads (enriched_at NULLS FIRST);
