-- Comment-collection mechanic signal for creator scoring. The real trigger for a
-- good lead SOURCE isn't the bio — it's whether the account runs "comment X to
-- get Y" Reels that flood with artist comments. We sample recent posts and store
-- the average comment count + how many captions use the comment-farming mechanic.
ALTER TABLE spotify_creators
  ADD COLUMN IF NOT EXISTS avg_comments INT,       -- mean comments across sampled posts
  ADD COLUMN IF NOT EXISTS mechanic_hits INT,      -- captions matching the comment-mechanic
  ADD COLUMN IF NOT EXISTS sampled_posts INT,      -- how many posts we looked at
  ADD COLUMN IF NOT EXISTS is_reel_heavy BOOLEAN;  -- mostly Reels (video)
