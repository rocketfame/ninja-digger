-- Allow multiple chart types per source/date/position (e.g. top_tracks and hype_tracks same day).
-- Only run on legacy chart_entries (with source_id). Skip if already v2 (013 applied).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chart_entries' AND column_name = 'source_id'
  ) THEN
    UPDATE chart_entries SET chart_type = 'legacy' WHERE chart_type IS NULL;
    ALTER TABLE chart_entries DROP CONSTRAINT IF EXISTS chart_entries_source_id_chart_date_position_key;
    ALTER TABLE chart_entries DROP CONSTRAINT IF EXISTS chart_entries_source_date_position_type_key;
    ALTER TABLE chart_entries ADD CONSTRAINT chart_entries_source_date_position_type_key
      UNIQUE (source_id, chart_date, position, chart_type);
  END IF;
END $$;
