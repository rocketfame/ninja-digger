-- Spotify/music-promo relevance signal. The comment-mechanic alone isn't enough —
-- an FL Studio tutorial or a music-therapy page also farms comments, but their
-- commenters aren't promo-hungry artists. We only want accounts whose mechanic is
-- FOR music promotion (Spotify/playlists/streams/exposure). promo_hits = captions
-- that mention the Spotify/music-promo angle; a zero here caps the score.
ALTER TABLE spotify_creators
  ADD COLUMN IF NOT EXISTS promo_hits INT;
