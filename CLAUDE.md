# Ninja Digger — Claude Code Instructions

## Режим пригадування
При старті нової сесії:
1. Прочитай цей CLAUDE.md
2. Прочитай файли в knowledge/
3. Перевір актуальність даних перед тим як щось пропонувати

## Проєкт
**Ninja Digger** — Data-research tool для Beatport артистів, DJ, лейблів. Підтримка outreach-процесу: збір даних, скоринг лідів, сегментація, збагачення профілів.

## Стек
- Next.js 15 (App Router), React 19, TypeScript
- PostgreSQL (Neon/Supabase/Vercel Postgres)
- Tailwind CSS
- Cheerio (парсинг), Nodemailer
- Vercel (хостинг + cron jobs)

## Архітектура
7 фаз: Foundation → Data Model → Ingestion (Beatport charts, daily cron 06:00 UTC) → Normalization → Scoring → UI (/leads, /artist/[id]) → Enrichment (LLM) → Outreach Support (CSV export)

## Правила розробки
1. Мова спілкування — ЗАВЖДИ українська
2. Код та коментарі — англійською
3. TypeScript strict mode
4. Не ускладнювати — MVP важливіший за архітектурну красу
5. Секрети тільки в .env — ніколи не комітити ключі
6. Перед деплоєм — перевіряти CSS (responsive, overflow, align-items)

## Команди
```bash
npm run dev          # локальний сервер
npm run build        # білд
npm run lint         # лінтер
```

## Структура
- `app/` — Next.js routes (leads, artist, analytics, segments, api)
- `ingest/` — Beatport/Songstats data ingestion
- `normalize/` — Name normalization & deduplication
- `segment/` — Lead scoring & segmentation
- `enrich/` — LLM-based enrichment
- `lib/` — DB utils, outreach logic
- `migrations/` — SQL migrations (001–010)
- `knowledge/` — проєктна документація
