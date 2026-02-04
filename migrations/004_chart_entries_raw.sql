-- Ninja Digger — Phase 2 (hybrid): source-aware chart_entries
-- Raw data + chart_type, genre. Append-only. Run after 003.

ALTER TABLE chart_entries
  ADD COLUMN IF NOT EXISTS chart_type TEXT,
  ADD COLUMN IF NOT EXISTS genre TEXT,
  ADD COLUMN IF NOT EXISTS artist_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS track_title_raw TEXT;

COMMENT ON COLUMN chart_entries.chart_type IS 'top100 | hype | release | dj_support';
COMMENT ON COLUMN chart_entries.artist_name_raw IS 'Raw artist name from source (before normalization)';
COMMENT ON COLUMN chart_entries.track_title_raw IS 'Raw track title from source (before normalization)';

CREATE INDEX IF NOT EXISTS idx_chart_entries_chart_type ON chart_entries(chart_type);
CREATE INDEX IF NOT EXISTS idx_chart_entries_genre ON chart_entries(genre);
