# Ninja Digger

Deterministic data-research tool for Beatport-related artists, DJs, and labels (manual outreach support).

**Stack:** Next.js (App Router), Vercel, Postgres, Songstats (Phase 2).

### Deploy на Vercel

У репозиторії є `vercel.json` з `"framework": "nextjs"` — Vercel використовує Next.js build, а не статичний output. Якщо в налаштуваннях проекту було вказано **Output Directory: public**, залиште його порожнім (або видаліть) — для Next.js output керує фреймворк.

---

## Phase 0 — Foundation ✓

- Next.js app (App Router)
- Environment: copy `.env.example` → `.env`, set `DATABASE_URL`
- DB: `lib/db.ts` — `pool`, `query()`, `checkConnection()`
- Folders: `ingest`, `normalize`, `segment`, `enrich`, `lib`, `app/leads`, `app/artist`

### Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Verify database connection

Set `DATABASE_URL` in `.env`, then from any server-side code:

```ts
import { checkConnection } from "@/lib/db";
const ok = await checkConnection(); // true if connected
```

No APIs, no data models, no UI beyond the placeholder home page.

---

## Phase 1 — Data Model (Schema First) ✓

- **SQL schema:** `migrations/001_initial_schema.sql` — таблиці: `sources`, `artists`, `labels`, `tracks`, `chart_entries`, `lead_scores`, `artist_notes`, зв’язки та індекси.
- **Міграції:** `npm run db:migrate` — виконує всі `migrations/*.sql` по черзі (потрібен `DATABASE_URL` у `.env`).
- **Seed:** `migrations/002_seed.sql` — 1 джерело (Songstats test), 2 артисти, 1 лейбл, 2 треки.
- **Жанри артиста:** `migrations/003_artist_genres.sql` — у таблиці `artists` поле `genres` (TEXT[]): один або кілька жанрів.

### Запуск міграцій

```bash
cp .env.example .env
# Вказати DATABASE_URL у .env
npm run db:migrate
```

### Перевірка (приклад SELECT)

Після міграцій у БД можна виконати:

```sql
SELECT a.id, a.name, a.genres FROM artists a;
SELECT t.title, a.name AS artist, a.genres, l.name AS label
  FROM tracks t
  JOIN artists a ON t.artist_id = a.id
  LEFT JOIN labels l ON t.label_id = l.id;
```

Definition of Done Фази 1: всі таблиці створені, зв’язки задані, seed завантажений, схема стабільна. Інгestion, UI, enrichment, LLM — поки не використовуються.
