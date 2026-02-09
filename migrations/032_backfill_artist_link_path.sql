-- Заповнити artist_link_path для існуючих рядків: маємо artist_beatport_id (числовий) і artist_name — будуємо шлях /artist/slug/id (slug з імені, як на BPTT/Beatport).
-- Запустити після 031. Один раз для великої бази.

-- Slug з імені: lowercase, пробіли/не-букви → дефіс, обрізати дефіси. Порожній → 'artist'.
UPDATE bptoptracker_daily
SET artist_link_path = '/artist/' || COALESCE(
  NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(TRIM(artist_name)), '[^a-z0-9]+', '-', 'g')), ''),
  'artist'
) || '/' || artist_beatport_id
WHERE artist_beatport_id IS NOT NULL
  AND artist_beatport_id ~ '^\d+$'
  AND artist_name IS NOT NULL
  AND TRIM(artist_name) <> ''
  AND (artist_link_path IS NULL OR artist_link_path = '');

UPDATE chart_entries
SET artist_link_path = '/artist/' || COALESCE(
  NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(TRIM(artist_name)), '[^a-z0-9]+', '-', 'g')), ''),
  'artist'
) || '/' || artist_beatport_id
WHERE artist_beatport_id IS NOT NULL
  AND artist_beatport_id ~ '^\d+$'
  AND artist_name IS NOT NULL
  AND TRIM(artist_name) <> ''
  AND (artist_link_path IS NULL OR artist_link_path = '');
