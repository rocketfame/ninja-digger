# Ninja Digger — Детальний опис проєкту

> **Оновлення 2026-08-13:** (1) Причина 3.5-місячної зупинки ingestion — переповнення Neon 512MB через баг cleanup (`fetched_date` замість `snapshot_date`); виправлено, дані бекфілнуто за 46 днів (`scripts/backfill-bptt.mjs`). (2) Прямий скрапінг beatport.com вимкнено (Cloudflare 403) — джерело тільки BPTT; вмикається `ENABLE_BEATPORT_DIRECT=1`. (3) Слаги жанрів: `r-b`→`rb`, додано `dj-edits`, `latin-electronic` (47 жанрів). (4) Enrichment: додано крок MusicBrainz url-rels (безкоштовні канонічні лінки). (5) Міграція 042: unique constraint контактів на LOWER(TRIM(value)), CHECK на status. (6) Outreach: фільтр email_blacklist + status='ok' у всіх send-запитах, auth через CRON_SECRET.

> Документ для передачі контексту в Claude або інший AI. Описує стек, архітектуру та бізнес-логіку сервісу.

---

## 1. Що це за продукт

**Ninja Digger** — CRM для outreach до електронних артистів, які потрапили в Beatport чарти. Джерело даних — **BP Top Tracker** (BPTT). Ми не скрапимо Beatport напряму; BPTT і Beatstats — це агрегатори Beatport-даних.

**Основні можливості:**
- Перегляд лідів за сегментами (Новачки, Топ-перформер, Спад тощо)
- Пошук контактів (email, Instagram, SoundCloud, Linktree, RA тощо) через enrichment
- Outreach-шаблони (3 дотики email, 1 DM для соцмереж)
- Відстеження статусу комунікації (Новий → 1-й контакт → Відповів → Виграно)
- Позначення помилкових контактів і ресканування

---

## 2. Стек технологій

| Компонент | Версія |
|-----------|--------|
| Next.js | ^15.0.0 |
| React | ^19.0.0 |
| PostgreSQL | pg ^8.13.0 (Neon / Vercel / Supabase) |
| Tailwind CSS | ^3.4.0 |
| TypeScript | ^5.0.0 |
| cheerio | ^1.0.0 (парсинг HTML) |
| undici | ProxyAgent для enrichment (опційно) |

**Скрипти:**
- `npm run dev` — dev сервер (127.0.0.1:3000)
- `npm run build` — міграції + next build
- `npm run db:migrate` — тільки міграції

---

## 3. Структура проєкту

```
ninja-digger/
├── app/
│   ├── layout.tsx              # Root layout, dark theme, uk locale, BackgroundSyncTrigger, ToastProvider
│   ├── page.tsx                # Головна, посилання на /leads
│   ├── globals.css
│   ├── components/
│   │   ├── NavBar.tsx          # Головна, Beatport Leads
│   │   ├── BackgroundSyncTrigger.tsx   # GET /api/internal/bptoptracker/background-sync
│   │   ├── Toast.tsx, ButtonSpinner.tsx
│   ├── leads/
│   │   ├── page.tsx            # Головна сторінка лідів, сегменти, фільтри, KPI
│   │   ├── LeadsTable.tsx
│   │   ├── LeadsDateRangeFilter.tsx
│   │   ├── BptoptrackerBackfill.tsx
│   │   ├── RunEnrichmentOnLeadsButton.tsx
│   │   ├── BatchRescanButton.tsx
│   │   ├── OracleModal.tsx, DiscoveryControl.tsx
│   ├── artist/
│   │   ├── ArtistBPContent.tsx  # v2 сторінка артиста (beatport_id або slug)
│   │   └── bp/[id]/
│   │       ├── page.tsx
│   │       ├── ArtistLeadCard.tsx   # Статус, посилання, контакти, flag, enrich, outreach
│   │       ├── ArtistChartHistory.tsx
│   │       ├── LinkIcon.tsx
│   │       └── LinkToLeadForm.tsx
│   ├── bptoptracker/
│   │   ├── page.tsx
│   │   └── link/page.tsx       # Ручне зв'язування BPTT artist_name → artist_beatport_id
│   └── api/
│       ├── cron/
│       │   ├── daily/route.ts   # 06:00, 18:00 UTC: discovery + ingest + BPTT + sync + normalize + score
│       │   ├── normalize/route.ts, score/route.ts, ingest/route.ts
│       ├── internal/
│       │   ├── bptoptracker/   # sync, refresh-now, background-sync, backfill, link, import-paste
│       │   ├── enrich/         # artist, segment, leads, flag, rescan-flagged
│       │   ├── lead-profile/[artistId]
│       │   └── score
│       └── leads/export
├── lib/
│   ├── db.ts                   # pg Pool, query(), connectionTimeoutMillis 15000
│   ├── bptoptrackerSync.ts     # bptoptracker_daily → chart_entries
│   ├── bptoptrackerDaily.ts    # Fetch BPTT для BPTOPTRACKER_GENRES
│   ├── bptoptrackerFetch.ts    # Парсинг HTML BPTT
│   ├── bptoptrackerAuth.ts, bptoptrackerBlocklist.ts, bptoptrackerUrl.ts
│   ├── enrichV1.ts             # Пошук контактів (DDG/Bing/Startpage, RA, SoundCloud API v2)
│   ├── formatDate.ts
│   └── beatportArtist.ts
├── segment/
│   ├── normalize.ts            # refresh_artist_metrics()
│   └── score.ts                # refresh_lead_scores_v2()
├── ingest/                     # Discovery, beatport, songstats
├── migrations/                 # 38+ міграцій
├── scripts/migrate.mjs
├── docs/
│   ├── ENRICHMENT.md, ENRICHMENT_ROADMAP.md, ENRICHMENT_STRATEGY.md
│   └── PROJECT_SUMMARY.md      # цей документ
├── vercel.json                 # Crons: /api/cron/daily 06:00, 18:00 UTC
└── .cursor/rules/bptoptracker-beatstats-beatport.mdc
```

---

## 4. База даних (ключові таблиці)

| Таблиця | Призначення |
|---------|-------------|
| **charts_catalog** | Каталог чартів (platform, chart_type, genre_slug, url). BPTT-чарти створюються при sync. |
| **chart_entries** | Сирі снапшоти чартів (chart_id, snapshot_date, position, track_title, artist_name, artist_beatport_id, artist_link_path). UNIQUE(chart_id, snapshot_date, position). |
| **artist_metrics** | Агреговані метрики на артиста (first_seen, last_seen, total_days_in_charts, total_chart_entries, avg_position, best_position, genres, momentum_7d, momentum_30d). Заповнюється `refresh_artist_metrics()`. |
| **lead_scores** | Lead score і сегмент (artist_beatport_id, score, segment, signals JSONB). Заповнюється `refresh_lead_scores_v2()`. |
| **lead_profiles** | Статус outreach і нотатки (artist_beatport_id, status, notes). Status: New, Attempt 1, Attempt 2, Responded, In Progress, Won, No Response, Blacklist. |
| **artist_links** | Знайдені посилання (instagram, soundcloud, linktree, resident_advisor, bandcamp, mixcloud, website, facebook, twitter). UNIQUE(artist_beatport_id, type). Колонка **status**: ok \| flagged. |
| **artist_contacts** | Контакти (email). UNIQUE(artist_beatport_id, type, value). Колонка **status**: ok \| flagged. |
| **bptoptracker_daily** | Снапшоти BPTT (snapshot_date, genre_slug, position, track_title, artist_name, artist_beatport_id, artist_link_path). |
| **bptoptracker_artist_links** | Ручне зв'язування artist_name → artist_beatport_id. |
| **enrichment_runs** | Завдання enrichment (scope: artist \| segment \| leads, status). |
| **url_cache** | Кеш HTML для enrichment (url, body, fetched_at, ttl_seconds). |
| **background_sync_runs** | Throttling для background sync. |

---

## 5. Потік даних

### Джерела

- **BP Top Tracker (BPTT)** — основний джерело чартів Beatport. URL: `https://www.bptoptracker.com/top/track/{genre}/{YYYY-MM-DD}`.
- **Beatstats** — згадується в правилах як аналогічне джерело Beatport; в коді поки не використовується.
- **Beatport discovery** — неділя: додавання нових чартів у `charts_catalog`.

### Синхронізація

1. **BPTT fetch** (`lib/bptoptrackerFetch.ts`, `lib/bptoptrackerDaily.ts`):
   - Авторизація: `BPTOPTRACKER_EMAIL` + `BPTOPTRACKER_PASSWORD` або `BPTOPTRACKER_COOKIE`.
   - Парсинг HTML (cheerio): position, track_title, artist_name, artist_beatport_id, artist_link_path.
   - Запис у `bptoptracker_daily`.

2. **Sync BPTT → chart_entries** (`lib/bptoptrackerSync.ts`):
   - Резолв `artist_beatport_id`: `bptoptracker_artist_links` → `artist_metrics` → synthetic `bptoptracker:slug`.
   - Створення `charts_catalog` для кожного genre.
   - INSERT в `chart_entries`.

3. **Normalize** (`refresh_artist_metrics()`): `chart_entries` → `artist_metrics`.

4. **Score** (`refresh_lead_scores_v2()`): `artist_metrics` → `lead_scores`.

### Тригери

- **Background**: при завантаженні сторінки — `BackgroundSyncTrigger` → GET `/api/internal/bptoptracker/background-sync` (throttle ~60 хв).
- **Cron**: `/api/cron/daily` (06:00, 18:00 UTC).

---

## 6. Бізнес-логіка: сегменти (migration 037)

| Сегмент | Умова |
|---------|-------|
| **NEWCOMER** | 1–4 дні в чарті, best_position > 60, last_seen >= ref_date - 4 |
| **NEW_ENTRY** | 5–7 днів, last_seen >= ref_date - 7; або 1–4 дні з best_position ≤ 60 |
| **FAST_GROWING** | momentum_7d > 3 |
| **TOP_PERFORMER** | best_position ≤ 10, total_days_in_charts ≥ 8 |
| **DECLINING** | momentum_7d < -3, total_days_in_charts ≥ 5 |
| **CONSISTENT** | 8–30 днів, momentum_7d ≥ -3; або > 30 днів |

### first_seen / last_seen

- `first_seen` = MIN(snapshot_date) по `chart_entries`.
- `last_seen` = MAX(snapshot_date).
- Для NEWCOMER/NEW_ENTRY фільтр "Сьогодні" використовує `first_seen` (хто вперше з'явився сьогодні).

---

## 7. Enrichment (пошук контактів)

**lib/enrichV1.ts:**
- Пошук: DuckDuckGo HTML → Bing → Startpage (опційно SEARCH_PROXY_URL, SCRAPER_API_KEY).
- Джерела: Resident Advisor, Linktree, SoundCloud API v2, Bandcamp, Mixcloud, Reverb Nation, Instagram.
- Запис: `artist_links`, `artist_contacts`.
- Rate limit ~2 с, url_cache 24 год.

**API:**
- `POST /api/internal/enrich/artist?artistId=...&rescan=1` — enrich одного артиста; rescan=1 видаляє flagged і інвалідує url_cache.
- `POST /api/internal/enrich/segment`, `POST /api/internal/enrich/leads`
- `POST /api/internal/enrich/flag` — body: `{ table: "link"|"contact", id, flagged: true|false }`
- `POST /api/internal/enrich/rescan-flagged` — batch rescan артистів з flagged контактами.

**Flag / Rescan:**
- Користувач може позначити link або contact як помилковий (status=flagged).
- Кнопка "Ресканувати" на картці артиста: видаляє flagged, інвалідує url_cache, запускає enrichment заново.
- Batch rescan — для кількох артистів з flagged (фільтр withFlagged на /leads).

---

## 8. Outreach (шаблони повідомлень)

### Email — 3 дотики

Зберігається в `lead_profiles.status` і `[email:1,2,3]` в notes.

| Touch | Subject | Status |
|-------|---------|--------|
| 1 | Congrats on your recent Beatport chart entry \| Promosound | Attempt 1 |
| 2 | Re: chart momentum | Attempt 2 |
| 3 | Should I close the loop? | No Response |

Текст від Max з PromoSound. Підставляється `[Artist Name]` з `displayName`.

### Social DM — 1 повідомлення

7 варіантів тексту (socialVariants), випадковий вибір на клієнті (useEffect, щоб уникнути hydration mismatch). Сенс: привітання з Beatport chart entry, Daily Push, посилання на трек + чарт.

**Відстеження каналів:** `[via:instagram,soundcloud]` в notes — через які мережі надіслано.

---

## 9. Сторінка лідів (/leads)

- **Сегменти**: NEWCOMER, NEW_ENTRY, CONSISTENT, FAST_GROWING, DECLINING, TOP_PERFORMER.
- **Фільтри**: segment, genre, dateFrom/dateTo, withContacts, withEmails, withSocials, inWork, withFlagged.
- **Сортування**: score, entries, first_seen, last_seen, artist.
- **KPI**: totalLeads, newToday, withEmails, withSocials, inWork, avgPosition, withFlagged.
- **Blocklist**: виключення артистів за ім'ям (`bptoptrackerBlocklist`).

---

## 10. Сторінка артиста (/artist/[id])

- **id** — числовий Beatport ID або `bptoptracker:slug`.
- **ArtistLeadCard**: статус (кнопки New, 1-й контакт, Відповів тощо), посилання (beatport, bptoptracker, Linktree, SoundCloud, Instagram…), email з копіюванням і Gmail compose, outreach (Social DM / Email 3 touches), flag/rescan.
- **ArtistChartHistory**: графік позицій у чартах.
- **Кнопка "Пошук контактів"** — викликає enrichment для цього артиста.

---

## 11. Environment variables

```env
DATABASE_URL=postgresql://...?sslmode=require

# BP Top Tracker
BPTOPTRACKER_EMAIL=...
BPTOPTRACKER_PASSWORD=...
# або BPTOPTRACKER_COOKIE=session=...
BPTOPTRACKER_GENRES=afro-house,techno,house

# Cron
CRON_SECRET=...

# Enrichment (опційно)
SEARCH_PROXY_URL=http://user:pass@proxy:80
SCRAPER_API_KEY=...
```

---

## 12. Важливі правила (.cursor/rules)

- **BP Top Tracker і Beatstats = Beatport**: їхні артисти вважаються Beatport-артистами. Ми не скрапимо Beatport для chart/artist даних.
- Synthetic ID: `bptoptracker:slug` для артистів без Beatport ID.

---

## 13. Типові задачі для AI

1. **Додати новий сегмент** — оновити `refresh_lead_scores_v2()` в міграції.
2. **Змінити outreach-шаблон** — `ArtistLeadCard.tsx`, `emailTemplates` / `socialVariants`.
3. **Додати нове джерело enrichment** — `lib/enrichV1.ts`, `discoverLinks()`.
4. **Виправити фільтр дат для сегменту** — `app/leads/page.tsx`, `dateConditionSeg`.
5. **Додати API** — `app/api/internal/.../route.ts`.
6. **Міграція БД** — новий файл у `migrations/`, запуск `node scripts/migrate.mjs`.
