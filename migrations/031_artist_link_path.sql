-- Зберігати повний шлях посилання на артиста з парсингу BPTT (/artist/slug/id) і використовувати його для Beatport і BPTT URL без переформатування.

ALTER TABLE bptoptracker_daily ADD COLUMN IF NOT EXISTS artist_link_path TEXT;
COMMENT ON COLUMN bptoptracker_daily.artist_link_path IS 'Path from chart page link: /artist/slug/id — use as-is for Beatport and BPTT URLs';

ALTER TABLE chart_entries ADD COLUMN IF NOT EXISTS artist_link_path TEXT;
COMMENT ON COLUMN chart_entries.artist_link_path IS 'Path from BPTT chart parse: /artist/slug/id — use for Beatport and BPTT artist URLs';
