-- Track a channel's video count so the YouTube-radar segment shows how active
-- the artist is (few videos = fresh/hungry, many = established).
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS video_count integer;
