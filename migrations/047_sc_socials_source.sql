-- RepostExchange submitters = active paying promoters with all socials attached.
-- Extend sc_artists with social handles and intent signals.
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS facebook TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS twitter TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS youtube TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS spotify TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS tiktok TEXT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS genres TEXT[];
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS reputation INT;
ALTER TABLE sc_artists ADD COLUMN IF NOT EXISTS is_promoter BOOLEAN DEFAULT false; -- pays for promo on Re-Ex

CREATE INDEX IF NOT EXISTS idx_sc_artists_promoter ON sc_artists(is_promoter) WHERE is_promoter = true;
