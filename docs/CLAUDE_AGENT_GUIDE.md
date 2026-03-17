# Інструкція для Claude: Ninja Digger

> Повна інструкція для AI-агента (Claude), який керує додатком: пошук лідів, enrichment, outreach, відстеження статусів.

---

## 1. Що таке Ninja Digger

**Ninja Digger** — CRM для outreach до електронних артистів з Beatport чартів. Джерело даних — **BP Top Tracker** (BPTT). Агент може:
- Шукати лідів за сегментами, жанрами, періодами
- Запускати пошук контактів (enrichment)
- Оновлювати статуси комунікації
- Копіювати email/DM-шаблони для ручного надсилання

---

## 2. URL-адреси та навігація

| URL | Призначення |
|-----|-------------|
| `http://127.0.0.1:3000/` | Головна |
| `http://127.0.0.1:3000/leads` | **Сторінка лідів** — основний робочий простір |
| `http://127.0.0.1:3000/leads?segment=NEWCOMER` | Ліди сегменту Новачки |
| `http://127.0.0.1:3000/leads?segment=NEWCOMER&genre=afro-house` | Новачки + жанр Afro House |
| `http://127.0.0.1:3000/leads?segment=NEWCOMER&dateFrom=2026-03-01&dateTo=2026-03-10` | Новачки за період |
| `http://127.0.0.1:3000/leads?withEmails=1` | Ліди з email |
| `http://127.0.0.1:3000/leads?withSocials=1` | Ліди з соцмережами |
| `http://127.0.0.1:3000/leads?inWork=1` | Ліди в роботі (не New) |
| `http://127.0.0.1:3000/leads?withFlagged=1` | Артисти з помилковими контактами |
| `http://127.0.0.1:3000/artist/{id}` | **Картка артиста** — контакти, outreach, статус |
| `http://127.0.0.1:3000/bptoptracker` | BP Top Tracker — зв'язування артистів |
| `http://127.0.0.1:3000/bptoptracker/link` | Ручне зв'язування artist_name → beatport_id |

**Параметри `/leads`:**
- `segment` — NEWCOMER, NEW_ENTRY, CONSISTENT, FAST_GROWING, DECLINING, TOP_PERFORMER
- `genre` — slug (afro-house, tech-house, house, melodic-house-techno тощо)
- `dateFrom`, `dateTo` — YYYY-MM-DD
- `withEmails=1`, `withSocials=1`, `withContacts=1` — фільтр за наявністю контактів
- `inWork=1` — тільки зі статусом ≠ New
- `withFlagged=1` — з помилковими контактами
- `sort` — score, entries, first_seen, last_seen, artist
- `order` — asc, desc
- `page` — пагінація

---

## 3. Сегменти лідів

| Сегмент | Опис |
|---------|------|
| **NEWCOMER** | 1–4 дні в чарті, best_position > 60 — свіжі новачки |
| **NEW_ENTRY** | 5–7 днів або 1–4 дні з топ-позицією |
| **FAST_GROWING** | momentum_7d > 3 — швидке зростання |
| **TOP_PERFORMER** | best_position ≤ 10, ≥ 8 днів — топ артисти |
| **DECLINING** | momentum_7d < -3 — спад |
| **CONSISTENT** | 8–30 днів або > 30 днів — стабільні |

---

## 4. Робочий процес пошуку лідів

### Крок 1: Відкрити сторінку лідів
```
GET /leads
```

### Крок 2: Обрати фільтри
- **Сегмент** — клік по чіпу (Новачки, Новий вхід, Стабільний тощо)
- **Жанр** — dropdown «Жанр» → обрати жанр (afro-house, tech-house, melodic-house-techno)
- **Період** — dropdown «Період» → Останні 4/7/30 днів або свій діапазон

### Крок 3: Запустити пошук контактів
- Кнопка **«Пошук контактів»** (зелена) — enrichment для поточного фільтра
- Шукає: Instagram, SoundCloud, Linktree, Resident Advisor, Bandcamp, Mixcloud, email
- Результати зберігаються в `artist_links`, `artist_contacts`

### Крок 4: Переглянути лідів
- Таблиця: Артист, Сегмент, Входжень, Вперше, Востаннє, Жанр, Позиція
- Клік по імені артиста → `/artist/{id}`

---

## 5. Картка артиста (/artist/[id])

**id** — числовий Beatport ID або `bptoptracker:slug` (наприклад `bptoptracker:artist-name`).

### Що є на картці
- **Статус** — кнопки: Новий, 1-й контакт, 2-й контакт, Відповів, В комунікації, Виграно, Не відповів, Blacklist
- **Посилання** — Beatport, BPTT, Linktree, Instagram, SoundCloud, RA, Bandcamp тощо
- **Email** — з копіюванням і Gmail compose
- **Outreach** — Email (3 дотики) або Social DM (1 повідомлення)
- **Пошук контактів** — enrichment для цього артиста
- **Flag / Рескан** — позначити помилковий контакт, ресканувати

### Outreach-шаблони
- **Email Touch 1** — Congrats on your recent Beatport chart entry
- **Email Touch 2** — Re: chart momentum (follow-up)
- **Email Touch 3** — Should I close the loop?
- **Social DM** — 7 варіантів привітання з chart entry + посилання

---

## 6. API для автоматизації

Базовий URL: `http://127.0.0.1:3000` (або порт, на якому працює dev-сервер).

### Enrichment (пошук контактів)

**Один артист:**
```
POST /api/internal/enrich/artist?artistId={artist_beatport_id}
POST /api/internal/enrich/artist?artistId={artist_beatport_id}&rescan=1  # з ресканом (видаляє flagged)
```

**Ліди за фільтром (batch):**
```
POST /api/internal/enrich/leads?segment=NEWCOMER&genre=afro-house&dateFrom=2026-03-01&dateTo=2026-03-10
```
Параметри: segment, genre, dateFrom, dateTo. Обробляє по батчах, повертає `{ ok, processed, linksAdded, contactsAdded, remaining }`.

**Позначити помилковий контакт:**
```
POST /api/internal/enrich/flag
Body: { "table": "link" | "contact", "id": "uuid", "flagged": true | false }
```

**Рескан артистів з flagged:**
```
POST /api/internal/enrich/rescan-flagged
```

### Lead profile (статус, нотатки)

**Отримати:**
```
GET /api/internal/lead-profile/{artistId}
```

**Оновити:**
```
PATCH /api/internal/lead-profile/{artistId}
Body: { "status": "Attempt 1", "notes": "..." }
```
Дозволені status: New, Attempt 1, Attempt 2, Responded, In Progress, Won, No Response, Blacklist, Contacted, Lost.

### BPTT (дані)

**Оновити дані з BP Top Tracker:**
```
POST /api/internal/bptoptracker/refresh-now
```

**Бекфіл за період (всі жанри):**
```
POST /api/internal/bptoptracker/backfill
Body: { "genreSlug": "__all__", "dateFrom": "2026-03-01", "dateTo": "2026-03-10" }
```

**Синхронізація (без fetch):**
```
POST /api/internal/bptoptracker/sync
```

---

## 7. Статуси outreach

| Статус | Значення |
|--------|----------|
| **New** | Ще не контактували |
| **Attempt 1** | Надіслано 1-й email / 1-й DM |
| **Attempt 2** | Надіслано 2-й email |
| **Responded** | Артист відповів |
| **In Progress** | В комунікації |
| **Won** | Виграно (deal) |
| **No Response** | Не відповів після 3 дотиків |
| **Blacklist** | Не контактувати |
| **Contacted** | Надіслано Social DM |
| **Lost** | Втрачено |

---

## 8. Типовий сценарій для Claude

### Сценарій A: Знайти нових артистів і шукати контакти
1. Відкрити `/leads?segment=NEWCOMER&dateFrom=2026-03-01&dateTo=2026-03-10`
2. Викликати `POST /api/internal/enrich/leads?segment=NEWCOMER&dateFrom=2026-03-01&dateTo=2026-03-10`
3. Дочекатися завершення (перевіряти `remaining` у відповіді)
4. Відкрити `/leads?segment=NEWCOMER&withEmails=1` — ліди з email

### Сценарій B: Підготувати outreach для артиста
1. Відкрити `/artist/{artist_beatport_id}`
2. Якщо немає контактів — викликати `POST /api/internal/enrich/artist?artistId={id}`
3. Скопіювати email або DM-шаблон з картки
4. Після надсилання — оновити статус: `PATCH /api/internal/lead-profile/{id}` з `{ "status": "Attempt 1" }`

### Сценарій C: Обробити ліди «В роботі»
1. Відкрити `/leads?inWork=1`
2. Для кожного артиста перевірити статус на картці
3. Якщо відповів — оновити на `Responded` або `In Progress`
4. Якщо виграно — `Won`

### Сценарій D: Виправити помилкові контакти
1. Відкрити `/leads?withFlagged=1`
2. На картці артиста — кнопка «Ресканувати» (або `POST /api/internal/enrich/artist?artistId={id}&rescan=1`)
3. Або batch: `POST /api/internal/enrich/rescan-flagged`

---

## 9. Оновлення даних BPTT

Щоб мати свіжі ліди по всіх жанрах:
- У `.env`: `BPTOPTRACKER_GENRES=all` (всі 44 жанри)
- Кнопка «Оновити дані з BP Top Tracker» на `/leads`
- Або `POST /api/internal/bptoptracker/refresh-now`
- Для бекфілу: `POST /api/internal/bptoptracker/backfill` з `genreSlug: "__all__"`

---

## 10. Джерела контактів (enrichment)

Enrichment шукає через DuckDuckGo → Bing → Startpage:
- **Linktree / Beacons / Carrd** — email, соцмережі
- **Resident Advisor** — профіль DJ, email
- **SoundCloud** — профіль, email з біо
- **Bandcamp, Mixcloud, Reverb Nation** — профілі, контакти
- **Instagram** — профіль (перевірка nameMatches)

Email витягується тільки з профілів і офіційних сторінок, не з SERP.

---

## 11. Швидкі посилання для Claude

```
# Ліди
/leads
/leads?segment=NEWCOMER
/leads?segment=NEWCOMER&genre=afro-house
/leads?withEmails=1
/leads?inWork=1

# Артист (id = beatport_id або bptoptracker:slug)
/artist/123456
/artist/bptoptracker:artist-name

# API
POST /api/internal/enrich/artist?artistId=123456
POST /api/internal/enrich/leads?segment=NEWCOMER&dateFrom=2026-03-01&dateTo=2026-03-10
PATCH /api/internal/lead-profile/123456  Body: {"status":"Attempt 1"}
POST /api/internal/bptoptracker/refresh-now
```

---

## 12. Обмеження та поради

- **Rate limit** enrichment: ~2 с між запитами, url_cache 24 год
- **Помилкові контакти** — позначити flag, потім rescan
- **Синтетичні ID** — артисти без Beatport ID мають `bptoptracker:slug`
- **Період для NEWCOMER** — використовує `first_seen` (хто вперше з'явився в цьому діапазоні)
- **Жанр у URL** — завжди slug (afro-house, не "Afro House")
