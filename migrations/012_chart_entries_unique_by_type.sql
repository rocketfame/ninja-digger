-- Allow multiple chart types per source/date/position (e.g. top_tracks and hype_tracks same day).
UPDATE chart_entries SET chart_type = 'legacy' WHERE chart_type IS NULL;

ALTER TABLE chart_entries
  DROP CONSTRAINT IF EXISTS chart_entries_source_id_chart_date_position_key;

ALTER TABLE chart_entries
  ADD CONSTRAINT chart_entries_source_date_position_type_key
  UNIQUE (source_id, chart_date, position, chart_type);
