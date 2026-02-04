-- Ninja Digger — Phase 1: Мінімальний seed (1–2 тестових артисти)
-- Запускати після 001_initial_schema.sql

-- Джерело для тестів
INSERT INTO sources (name, slug)
VALUES ('Songstats (test)', 'songstats')
ON CONFLICT (slug) DO NOTHING;

-- 2 тестових артисти (вставити тільки якщо ще немає)
INSERT INTO artists (name)
SELECT x.name FROM (VALUES ('Test Artist One'), ('Test Artist Two')) AS x(name)
WHERE NOT EXISTS (SELECT 1 FROM artists WHERE name = x.name);

-- 1 тестовий лейбл
INSERT INTO labels (name)
SELECT 'Test Label'
WHERE NOT EXISTS (SELECT 1 FROM labels WHERE name = 'Test Label');

-- Треки для тестових артистів (прив’язка до artist id 1, 2 та label 1)
INSERT INTO tracks (title, artist_id, label_id)
SELECT 'Test Track A', a.id, l.id
  FROM artists a
  CROSS JOIN (SELECT id FROM labels WHERE name = 'Test Label' LIMIT 1) l(id)
  WHERE a.name = 'Test Artist One'
  AND NOT EXISTS (SELECT 1 FROM tracks WHERE title = 'Test Track A' AND artist_id = a.id);

INSERT INTO tracks (title, artist_id, label_id)
SELECT 'Test Track B', a.id, l.id
  FROM artists a
  CROSS JOIN (SELECT id FROM labels WHERE name = 'Test Label' LIMIT 1) l(id)
  WHERE a.name = 'Test Artist Two'
  AND NOT EXISTS (SELECT 1 FROM tracks WHERE title = 'Test Track B' AND artist_id = a.id);
