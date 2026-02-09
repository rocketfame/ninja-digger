-- Поширити artist_link_path на рядки з синтетичним id: для того ж artist_name взяти шлях з рядка, де вже є path (числовий id).
-- Після 032 частина рядків має path, частина (synthetic id) — ні. Цей UPDATE копіює path за іменем артиста.

UPDATE chart_entries ce
SET artist_link_path = ref.path
FROM (
  SELECT LOWER(TRIM(artist_name)) AS name_key, MAX(artist_link_path) AS path
  FROM chart_entries
  WHERE artist_link_path IS NOT NULL AND artist_link_path <> '' AND artist_name IS NOT NULL
  GROUP BY LOWER(TRIM(artist_name))
) ref
WHERE LOWER(TRIM(ce.artist_name)) = ref.name_key
  AND ce.artist_name IS NOT NULL
  AND TRIM(ce.artist_name) <> ''
  AND (ce.artist_link_path IS NULL OR ce.artist_link_path = '');
