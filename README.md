# Ninja Digger

Deterministic data-research tool for Beatport-related artists, DJs, and labels (manual outreach support).

**Stack:** Next.js (App Router), Vercel, Postgres. Chart mirrors first; Songstats optional later.

**Plan:** [PROJECT_PLAN.md](./PROJECT_PLAN.md) — Phase 0–7, hybrid ingestion (chart mirrors primary; enterprise APIs pluggable).

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

---

## Phase 2 — Data Ingestion (Hybrid: Chart Mirrors First) ✓

- **Інтерфейс:** `ingest/types.ts` — `ChartEntryInput`, `IngestionSource`. Будь-яке нове джерело реалізує `IngestionSource`; ніхто не пише в БД напряму.
- **Chart mirror (primary):** `ingest/sources/beatport.ts` — `BeatportSource.fetchEntries(date)`. Зараз stub; парсинг додати пізніше.
- **Опційний адаптер:** `ingest/songstats.ts` — `SongstatsSource` (вхід для майбутнього Songstats API).
- **Єдиний запуск:** `ingest/run.ts` — `runIngest(sourceSlug, date)`, `SOURCES = { beatport, songstats }`. Міграція 004: `chart_type`, `genre`, `artist_name_raw`, `track_title_raw`.
- **Cron:** `GET /api/cron/ingest` — за замовчуванням `source=beatport`; опційно `?source=songstats` або `?date=YYYY-MM-DD`. Захист: `Authorization: Bearer <CRON_SECRET>`.
- **Cron (Vercel):** у `vercel.json` — щоденно о 06:00 UTC.



### Definition of Done Фази 2 (гібрид)

- Щоденні снапшоти чартів зберігаються (chart mirror = основний трекінг).
- Кілька джерел можуть співіснувати; Songstats підключається як ще один source без зміни ядра.
- Немає залежності від зовнішнього API для MVP.

---

## Phase 3 — Normalization (Source-Agnostic) ✓

- **Міграції:** `005_normalization_source_aware.sql` — `artists.normalized_name`, `labels.normalized_name`, таблиці `artist_sources`, `label_sources` (зв’язок нормалізованого ID з джерелом і raw-назвою). `006_views_normalized.sql` — view `artist_chart_stats`, `artist_chart_history`.
- **Нормалізація назв:** `normalize/names.ts` — `normalizeName(str)` (trim, lowercase, collapse spaces). Використовується в ingest для зіставлення артистів/лейблів з різних джерел.
- **Ingest:** `ingest/run.ts` — `getOrCreateArtist(name, sourceId)` і `getOrCreateLabel(name, sourceId)` шукають по `normalized_name`, створюють з `normalized_name`, записують у `artist_sources` / `label_sources`.

### Definition of Done Фази 3

- Один логічний артист = один ID (нормалізація по `normalized_name`).
- Сирі дані джерел зберігаються (`artist_sources`, `label_sources`, raw у `chart_entries`).
- Нормалізовані view стабільні: `artist_chart_stats`, `artist_chart_history`.

---

## Phase 4 — Segmentation & Scoring (Multi-Signal SQL) ✓

- **Сигнали:** `artist_signals` (view) — appearances (A), avg_position (P), first_seen, last_seen, recency_days (R), momentum (M), source_count (S). Momentum = середня позиція 8–14 днів тому мінус середня позиція за останні 7 днів (positive = покращення).
- **Формула:** `artist_lead_score` (view): score = (A×2) + (100−P) + max(0, 30−R) + (M×3) + (S×5).
- **Сегменти:** core (A≥10 і P≤30), regular (A≥5), fresh (first_seen за останні 14 днів), momentum (M>0), flyers (решта).
- **Міграції:** `007_segmentation_signals.sql`, `008_segmentation_lead_score.sql`; функція `refresh_lead_scores()` для заповнення таблиці `lead_scores`.
- **Cron:** після інгestion викликається `refreshLeadScores()` (segment/refresh.ts); у відповіді — `leadScoresRefreshed`.

### Definition of Done Фази 4

- Сегменти оновлюються автоматично (view завжди актуальні; таблиця — після cron).
- Нові джерела не вимагають змін у логіці сегментації.
- Оцінки детерміновані, пояснювані (SQL).

---

## Phase 5 — Minimal Research UI ✓

- **Leads:** `/leads` — таблиця лідів з view `artist_lead_score`; фільтр по сегменту (all | core | regular | fresh | momentum | flyers); посилання на сторінку артиста.
- **Artist:** `/artist/[id]` — деталі артиста (ім’я, segment, score, appearances, first/last seen), таблиця chart history (дата, source, позиція, тип, трек, лейбл), блок нотаток.
- **Notes:** форма додавання нотатки (textarea + Save); server action `addNote` → INSERT у `artist_notes`, revalidate сторінки артиста.

### Definition of Done Фази 5

- Ліди переглядаються та фільтруються по сегменту.
- Історія артиста видна на сторінці артиста.
- Нотатки можна додавати та зберігати (read-only analytics + notes).
