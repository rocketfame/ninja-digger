# Enrichment Strategy — фінальна версія

Узгоджена стратегія збагачення лідів: OSINT-підхід, крос-перевірка джерел, пріоритет авторитетних вузлів. Реалізовуваний алгоритм і пофазний план.

---

## 🎯 Філософія Enrichment (ключове)

**Ми не "шукаємо email".**  
Ми ідентифікуємо артиста через авторитетні вузли і підтягуємо контакти тільки якщо вони підтверджені перехресно.

Приклади ланцюжків:
- **SoundCloud → links → Instagram / Linktree → email**
- **Resident Advisor → bio → booking**
- **Linktree → офіційні соцмережі → підтвердження**

Це **OSINT-підхід**, не scraper.

---

## 🧠 Core-принцип: Cross-Validation

Контакт або соцмережа вважається **валідною**, якщо:
- знайдена в **авторитетному джерелі**
- ім'я / slug / username **співпадає**
- **або** підтверджується **другим джерелом**

**Ідеальний кейс:**
- SoundCloud bio → Instagram + Linktree  
- Linktree → email + Bandcamp  
➡ confidence ↑↑  
➡ усе можна одразу записувати в artist profile

---

## 🧩 Дані на вході

- `artist_name`
- `beatport_url` (artist_beatport_id)
- `genre` / `segment`

**Ніяких** username / email на вході — це важливо.

---

## 🧭 Ієрархія джерел (фінал, затверджена)

### Для ідентифікації + лінків (порядок пошуку)

1. Linktree / Beacons / Carrd  
2. Resident Advisor  
3. SoundCloud  
4. Bandcamp  
5. Mixcloud  
6. Reverb Nation  
7. Instagram  
8. TikTok  
9. Website (опційно)

### Для email (пріоритет джерела)

1. Linktree / Beacons / Carrd  
2. Resident Advisor  
3. SoundCloud  
4. Bandcamp  
5. Mixcloud / Reverb Nation  
6. Website  
7. ❌ Direct "email search" — **тільки fallback**

---

## 🔁 Цільовий алгоритм (крок за кроком)

### 0️⃣ Підготовка

- Normalize `artist_name`
- Generate `slug`
- Підготувати `nameMatches` (case / diacritics / short name)

---

### 1️⃣ Пошук по типах (один запит на тип)

Порядок **жорстко фіксований:**

`linktree` → `resident_advisor` → `soundcloud` → `bandcamp` → `mixcloud` → `reverbnation` → `instagram` → `tiktok` → `website`

Для кожного типу:
- **1 запит** (DDG → Bing → Startpage)
- максимум **2 URL**
- fetch сторінки
- **nameMatches ≥ threshold** → ОК

---

### 2️⃣ Збір і аналіз лінків (крос-алгоритм)

Якщо джерело = **SoundCloud / RA / Linktree:**
- парсимо **всі зовнішні links** з сторінки
- класифікуємо (IG / TikTok / Website / Bandcamp)
- перевіряємо **nameMatches** для кожного

- ✔ Якщо співпадає → додаємо як **confirmed**
- ⚠ Якщо сумнів → додаємо як **low-confidence**

---

### 3️⃣ Email extraction (обережно)

Беремо **тільки:**
- `mailto:`
- email у **bio / contact** на профілі артиста
- email на **офіційному website**

Для кожного email: `source_type`, `source_url`, `confidence`.

**Не беремо:**
- SERP (результати пошуку)
- коментарі
- неофіційні агрегатори

---

### 4️⃣ Confidence scoring (простий, критичний)

| Джерело           | Confidence |
|-------------------|------------|
| Linktree          | 0.9        |
| Resident Advisor  | 0.95       |
| SoundCloud        | 0.8        |
| Bandcamp          | 0.85       |
| Instagram bio     | 0.7        |
| Website           | 0.9        |

- ⬆ Якщо підтверджено **2 джерелами** — підвищуємо.
- ⬇ Якщо тільки **одне** — залишаємо базовий.

---

## 🗂️ Збереження в БД

**artist_links**
- `artist_id` (artist_beatport_id)
- `type` (instagram / soundcloud / linktree / resident_advisor / bandcamp / mixcloud / reverbnation / tiktok / website)
- `url`
- `source`
- `confidence`

**artist_contacts**
- `artist_id`
- `type` (email / booking)
- `value`
- `source` (source_url)
- `confidence`

---

## 🖼️ UI / UX (фінальна логіка)

### Порядок лінків у картці артиста

1. Beatport  
2. BP Top Tracker  
3. Resident Advisor  
4. Linktree  
5. Instagram  
6. TikTok  
7. SoundCloud  
8. Bandcamp  
9. Mixcloud  
10. Reverb Nation  
11. Website  

### Email

- Список з підписом джерела: *via SoundCloud*, *via RA*, *via Linktree* тощо.
- Сортування за **confidence**.

---

## 🪜 Поетапна реалізація (затверджена)

### 🟢 Фаза 1 — Стабілізація (без нових джерел)

- Зафіксувати порядок `discoverLinks` згідно ієрархії.
- **Cross-validation** для SoundCloud / RA / Linktree → парсинг зовнішніх лінків, класифікація, nameMatches.
- UI: правильний порядок посилань + підписи email за джерелом.
- Enrichment запускається одразу після створення сегменту (кнопка на сторінці сегменту / Лідів).

### 🟡 Фаза 2 — TikTok + Website

- Додати тип `tiktok` (пошук, іконка, парсинг bio).
- `website` як окремий тип (пошук офіційного сайту).

### 🔵 Фаза 3 — Моніторинг

- Логування пошуку (кількість URL на запит, рушій).
- Таймаути / rate limit у конфіг.
- Fallback engines (DDG → Bing → Startpage) залишаються.

### ⚪ Фаза 4 (опційно)

- Official / booking email (тип або позначка).
- Agency detection.
- Enrichment confidence v2 (крос-підтвердження двох джерел → підвищення confidence).

---

## ✅ Критерії готовності (checklist)

- [ ] 1 клік enrichment після сегменту.
- [ ] Крос-підтверджені соцмережі (links з SoundCloud/RA/Linktree з nameMatches).
- [ ] Email з джерелом і пріоритетом у UI.
- [ ] Стабільний пошук (без шуму, rate limit).
- [ ] Ніякого "магічного" email scraping — тільки з профілів і офіційних сторінок.

---

## 🧠 Оцінка пропозиції "шукати напряму email через search"

**🔴 Відхилено як основна стратегія.**  
**🟡 Дозволено тільки як fallback** (наприклад, додатковий запит типу "Artist email contact" після основних джерел).

**Причина:** низька точність + спам-ризик. OSINT через авторитетні вузли дає кращу якість і не виглядає як агресивний скрапінг.

---

## 📌 Фінальне рішення

Стратегія:
- не виглядає як scraper;
- реально працює для outreach;
- масштабується;
- не знищить домени / репутацію.

**Зафіксовано як фінальна версія ENRICHMENT_STRATEGY.md.**
