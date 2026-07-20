# Архітектура — Ninja Digger

## Фази
| Фаза | Назва | Опис |
|------|-------|------|
| 0 | Foundation | Next.js, DB pool, структура |
| 1 | Data Model | SQL schema (sources, artists, labels, tracks, chart_entries, lead_scores) |
| 2 | Ingestion | Beatport chart mirror + Songstats (optional). Cron daily 06:00 UTC |
| 3 | Normalization | Deduplication via normalized_name |
| 4 | Scoring | Multi-signal lead scoring |
| 5 | UI | /leads (filterable), /artist/[id] (history & notes) |
| 6 | Enrichment | LLM-based bio/role/insight (artist_enrichment table) |
| 7 | Outreach | Status tracking, contact_email, CSV export |

## Ключові таблиці
- `sources` — джерела даних
- `artists` — артисти з normalized_name
- `labels` — лейбли
- `tracks` — треки
- `chart_entries` — позиції в чартах
- `lead_scores` — скоринг лідів
- `artist_notes` — нотатки
- `artist_enrichment` — LLM-збагачення
