-- Niche classification. The comment-mechanic + "viral" alone isn't enough:
-- rapvilleuk farms comments but its niche is VIRAL VIDEO / content shoots, not
-- Spotify streaming promo — its commenters are content creators, not artists
-- seeking playlist/stream growth. We classify each creator's niche and only
-- 'spotify_promo' scores high; viral_video / producer_edu / ig_growth are capped.
ALTER TABLE spotify_creators
  ADD COLUMN IF NOT EXISTS niche TEXT,          -- spotify_promo | viral_video | producer_edu | ig_growth | artist | other
  ADD COLUMN IF NOT EXISTS content_hits INT;    -- captions with viral-video/content signals
