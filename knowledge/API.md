# API — Ninja Digger

## Internal API Routes
- `GET /api/cron/ingest` — запуск ingestion (викликається Vercel cron)
- `GET /api/leads` — список лідів з фільтрацією
- `GET /api/artist/[id]` — деталі артиста
- `GET /api/analytics` — аналітика

## External Data Sources
- **Beatport** — HTML парсинг чартів через Cheerio (primary source)
- **Songstats** — опціональне джерело (secondary)

## Database
- PostgreSQL через connection pool
- Міграції в /migrations (001–010)
