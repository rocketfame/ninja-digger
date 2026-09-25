# База лейблів — як працює (з 25.09.2026)

Власна база record labels для продажу і для B2B. Працює сама, вкладка `/labels`, CSV з тими самими фільтрами.

## Конвеєр — `/api/cron/labels` (:04, :24, :44), код `lib/labels.ts`
1. **Інжест**
   - Beatport-чарти (BPTT, 46 жанрів, 31 день) — раз на день, ~3.8k лейблів, пакетно за 3 с.
   - Наша SC-база — шматками по 150k профілів за прогін (курсор `labels_sc_cursor`, по колу). Тригер у назві (records/recordings/label/imprint/music group, не в дужках) або лейбл описує себе в біо («is an independent label», «demos to:», «demo submission»). Точність звірена на вибірці: фрази на кшталт «A&R at X» / «Record Label Owner» — це артисти, не беремо.
   - Наш YouTube і Instagram — раз на день.
   - **Граф підписок**: лейбли підписані на сестринські лейбли → кожен A/B чи чартовий лейбл обходиться раз, нові кандидати йдуть тим самим шляхом. База сама розширює свої джерела.
2. **Резолв** — SC-профіль лейбла (пошук + жорсткий матч назви; якщо прийшов із нашої бази — за id), web-profiles (сайт, IG, FB, Bandcamp, Beatport), жанри з треків, форма демо (Trackstack/LabelRadar/Airtable/Google Forms).
3. **Країна** (`lib/labelCountries.ts`) — білий список тір 1–3. RU/BY/IR/KP/SY — ніколи; UA — лише топ (≥10k SC або ≥30 чарт-входжень). Без прапорця — мова біо (ы/э/ё/ъ = виключити) і TLD сайту.
4. **Краулінг сайту** — корінь домену + contact/demo/about (або /contact, /demos навмання) → адреси з роллю (demo/info/promo/press/booking) і URL-джерелом, спосіб подачі демо.
5. **Фільтри email**: `classifyEmail` (junk/placeholder/relay/hostile/жорсткі ролі) → MX → історія доставки (bounce/скарга/відписка/junk). **`not-ICP` у блеклисті НЕ вбиває адресу** — це саме лейбли, яких відсікли з артистського аутрічу.
6. **SMTP** — локально `npx tsx scripts/verify-labels.mjs [limit]` (порт 25 закритий на Vercel). Тільки явний 5xx = invalid.
7. **Оцінка**: A — SMTP-valid + активний лейбл; B — email є, скринька catch-all/unknown/pending; C — лише форма чи соцмережі.

Мейджори й дистриб'ютори (Sony/Warner/UMG-бренди, DistroKid, TuneCore, AWAL…) — `excluded`.
Щоденний звіт у Telegram «🏷 База лейблів» з віддачею кожного джерела.

## Джерела, додані 25.09 (друга хвиля)
- **Блеклист `not-ICP`** (`ingestFromBlacklist`, раз на день): «не артист» / «зірка» → SC-профіль, лише якщо назва чи біо про лейбл (подкасти/репост-канали відсіяні); «домен представництва» → кандидат із сайтом (freemail/ISP-домени на кшталт gmail, 163.com виключені). Домени часто агенції/івенти → поле **`kind`**: label | agency | other. Доменний кандидат стає label лише з доказом: текст сайту про релізи/демо, inbox demos@/submit@/records@, record/label у назві чи домені, або біо на SC. Вкладка за замовчуванням показує лише `kind=label`.
- **Discogs API** (`lib/discogs.ts`, `discogsBatch`, 20 лейблів/прогін, ліміт 60 запитів/хв): країна з поштової адреси в contact_info, сайт, email, материнський лейбл, **сублейбли → нові кандидати** (`discogs_sublabel`). Лейбл без SC-профілю оживає, якщо Discogs дав сайт. Потрібен `DISCOGS_TOKEN` (особистий токен з discogs.com/settings/developers) у `.env.local` і Vercel; без нього крок пропускається.

Ручний прогін одного джерела: `resolveBatch(n, via)` / `crawlBatch(n, via)`.
