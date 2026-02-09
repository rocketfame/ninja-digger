-- BP Top Tracker тягне дані з Beatport (API), тому каталог артистів той самий — numeric id = Beatport artist ID.
-- Зберігаємо його при парсингу чарту (посилання /artist/slug/id), щоб не використовувати synthetic id.

ALTER TABLE bptoptracker_daily ADD COLUMN IF NOT EXISTS artist_beatport_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bptoptracker_daily_artist_bp_id ON bptoptracker_daily(artist_beatport_id) WHERE artist_beatport_id IS NOT NULL;
COMMENT ON COLUMN bptoptracker_daily.artist_beatport_id IS 'Beatport artist ID from chart page link (/artist/slug/id); same as Beatport catalog';
