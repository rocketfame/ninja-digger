# Enrichment: як ми шукаємо контакти артиста

Enrichment — це автоматичний пошук публічних посилань і контактів артиста в інтернеті (без логіну, тільки публічні сторінки). Запускається з картки ліда кнопкою «Запустити Enrichment» або для всього сегмента.

## Джерела даних

- **Пошук:** спочатку DuckDuckGo HTML (`html.duckduckgo.com`); якщо результатів немає — Bing, потім Startpage. Rate limit 2 с між запитами. Парсинг DDG підтримує поточні посилання-редиректи (`uddg=`) та regex-резерв.
- **Кеш:** кожен завантажений URL зберігається в `url_cache` на 24 год, щоб не запитувати повторно.
- **Валідація:** на кожній сторінці перевіряємо, що в HTML згадується ім’я артиста (`nameMatches`), інакше посилання не зберігаємо.

## Що шукаємо і що заповнюємо

### 1. Instagram

- **Запит:** `"Artist Name" site:instagram.com`
- **Зберігаємо:** один URL профілю в `artist_links` з типом `instagram`.
- **Email:** з опису сторінки (якщо є в HTML) витягуємо email і зберігаємо в `artist_contacts` з `source_url` = посилання на сторінку.

### 2. SoundCloud

- **Запит:** `"Artist Name" site:soundcloud.com`
- **Зберігаємо:** URL профілю в `artist_links` з типом `soundcloud`.
- **Email:** з тексту сторінки (біо/опис) витягуємо email і додаємо в контакти з позначкою джерела (SoundCloud).

### 3. Linktree / Beacons / Carrd

- **Запит:** `"Artist Name" linktr.ee OR beacons.ai OR carrd.co`
- **Зберігаємо:** URL сторінки в `artist_links` з типом `linktree`.
- **Email:** головне джерело email — витягуємо з HTML (mailto: та звичайний текст), нормалізуємо (lowercase, без noreply/newsletter тощо), зберігаємо з високою впевненістю. У UI показується як «Email (Linktree)» / «Email (Beacons)» / «Email (Carrd)».

### 4. Resident Advisor (обов’язково для сцени)

- **Запит:** `"Artist Name" site:residentadvisor.net`
- **Зберігаємо:** URL профілю DJ в `artist_links` з типом `resident_advisor`.
- **Email:** якщо на сторінці RA є email (біо, контакт), витягуємо і зберігаємо в контакти з джерелом «Resident Advisor».

### 5. Bandcamp, Mixcloud, Reverb Nation (нішові сайти музикантів)

- **Bandcamp:** `"Artist Name" site:bandcamp.com` — артисти/лейбли, часто контакт у біо. Зберігаємо посилання та email з сторінки.
- **Mixcloud:** `"Artist Name" site:mixcloud.com` — DJ-профілі, контакти в описі. Посилання + витягування email.
- **Reverb Nation:** `"Artist Name" site:reverbnation.com` — профілі музикантів. Посилання + email з сторінки.

Усі ці сайти підходять для охоплення максимуму артистів: там часто є публічні контакти та посилання на соцмережі.

### 6. SoundCloud — контакти

- На SoundCloud часто є email у біо або в описі профілю. З кожної знайденої сторінки SoundCloud витягуємо до 6 email (тройки більше, ніж з інших типів сторінок), з підвищеною впевненістю для контактів.
- Додатково запускаємо пошук: `"Artist Name" soundcloud email contact` — щоб знайти сторінки, де артиста згадують разом із контактом.

### 7. Додатковий пошук контактів

- **Запити:** `"Artist Name" email contact`, `"Artist Name" linktr.ee booking`, `"Artist Name" soundcloud email contact`
- **Мета:** знайти сторінки з контактами/бронюванням із різних джерел.
- **Зберігаємо:** тільки email з цих сторінок у `artist_contacts` (посилання вже можуть бути з основних пошуків).

## Таблиці в БД

| Таблиця            | Що зберігає |
|--------------------|-------------|
| `artist_links`     | Один ряд на тип: `instagram`, `soundcloud`, `linktree`, `resident_advisor`, `bandcamp`, `mixcloud`, `reverbnation`, `website`. Поля: `artist_beatport_id`, `type`, `url`, `confidence`, `source`. |
| `artist_contacts`  | Email (поки що тільки тип `email`). Поля: `artist_beatport_id`, `type`, `value`, `source_url` (звідки знайшли), `confidence`. Унікальність: (artist, type, value). |

## Витягування email

- Шукаємо в HTML: `mailto:...` (вища впевненість) та regex для звичайних email.
- Нормалізація: lowercase, обрізка, відкидання параметрів після `?`, `#`.
- Відсікаємо: noreply@, newsletter@, donotreply@, webmaster@, а також рядки, що закінчуються на .png/.jpg (часто це не email).
- Один і той самий email не дублюємо (унікальність за значенням у БД).

## Відображення в UI

- **Посилання:** у блоці «Посилання» показуються Beatport, BP Top Tracker (якщо є ID), потім знайдені: Instagram, SoundCloud, Linktree, Resident Advisor, Сайт.
- **Контакти:** кожен email показується як посилання `mailto:`; якщо є `source_url`, поруч у дужках виводиться джерело, наприклад «Email (Linktree)», «Email (Resident Advisor)», «Email (SoundCloud)».

## Обмеження

- Немає headless-браузера: тільки публічний HTML. Сторінки за логіном або з динамічним контентом можуть не віддати email.
- Rate limit і кеш: не більше кількох запитів на артиста за один запуск, щоб не перевантажувати пошук і сайти.
- Тільки публічні дані; особисті повідомлення не використовуються.
