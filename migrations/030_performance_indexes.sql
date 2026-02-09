-- Оптимізація для масштабування: індекси під типові запити лідів.
-- Запит: WHERE segment = $1 ORDER BY score DESC NULLS LAST LIMIT n OFFSET m.

CREATE INDEX IF NOT EXISTS idx_lead_scores_segment_score_desc
  ON lead_scores (segment, score DESC NULLS LAST);

-- bptoptracker_daily: фільтри по жанру та даті (вже є idx по date, genre).
-- Якщо є запити по artist_name — окремий індекс не обовʼязковий (GROUP BY artist_name вже в LIMIT 500).
