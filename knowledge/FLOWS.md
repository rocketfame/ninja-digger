# Робочі процеси — Ninja Digger

## Data Ingestion Flow
1. Cron job (06:00 UTC) запускає ingestion
2. Парсить Beatport чарти через Cheerio
3. Нормалізує імена артистів (normalized_name)
4. Оновлює chart_entries, artists, labels, tracks
5. Перераховує lead scores

## Lead Scoring
- Мульти-сигнальний скоринг: appearances, position, recency, momentum, source_count
- Автоматична сегментація за score thresholds

## Outreach Flow
1. Фільтрація лідів на /leads
2. Перегляд профілю артиста на /artist/[id]
3. Додавання нотаток, контактів
4. CSV export для outreach
