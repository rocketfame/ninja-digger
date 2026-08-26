-- Outreach state for Radar leads (per-source segments → tailored offer).
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS touch INTEGER DEFAULT 0;
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS email_status TEXT;
CREATE INDEX IF NOT EXISTS idx_radar_outreach ON radar_leads (source, touch, email) WHERE email IS NOT NULL;
