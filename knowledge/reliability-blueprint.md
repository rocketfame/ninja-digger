# Reliability Blueprint — Ninja Digger

> Мета: система-годинник. Наявний стек (Next.js 15 + Vercel cron + Neon 512MB + Brevo),
> без зовнішніх платних сервісів — лише нормальні інженерні практики.
> Джерело: код-аудит 2026-08-21 + знання Jan-2026. Статуси: ✅ зроблено · 🔧 план.

## Шар 1 — Enrichment (звідки беруться емейли)

| Канал | Механізм | Стан | Throughput |
|---|---|---|---|
| Beatport | `enrich/leads` cron + `artist_contacts` | ✅ працює | ~2-6 контактів/год стабільно |
| SoundCloud | `sc-enrich` cron → bio/linktree/beacons/site/IG | ✅ ×7.5 | **30×conc6, 2/год ≈ 1440 спроб/день** (було 192) |
| Spotify | IG topsearch→info (браузер, вручну) | ⚠️ manual | залежить від сесії; вночі 0 — **прийнято** (не шукаємо сервіс) |

**SC-пул:** ~26k tier-A/B/promoter без email, 25.5k жодного разу не пробувані. Раніше
enrich=4/запуск у хвості 120с харвест-крона → база розкрилась би за ~133 дні. Тепер окремий
крон із власним 300с бюджетом і паралелізмом. Prune (24h) видаляє лише email-less
non-promoter tier≠A — tier-A/promoter тримаємо вічно, тому sc-enrich встигає їх дренувати.

**Spotify:** IG блокує server-side (web_profile_info gated). Автоматика неможлива без
логін-сесії → лишається браузерним (я ганяю щосесії). Не замінюємо на Apify тощо — рішення користувача.

## Шар 2 — Крон-надійність

**Принцип:** один крон = одна відповідальність. Vercel cron не ретраїть і не алертить сам,
логи Hobby живуть 1 год → треба ідемпотентність + власний моніторинг.

- ✅ `pipeline` = ТІЛЬКИ BP-відправка (self-heal винесено — важкий інжест не голодував sends)
- ✅ `ingest-heal` = self-heal чартів, власний 300с, вікна 07/09/11 UTC
- ✅ `sc-enrich` = окреме збагачення SC
- ✅ `watchdog` = self-audit 3×/день, Telegram-алерт лише на реальні збої
- ✅ `brevo-poll` = курсор рухається лише при повному успіху + алерт (метрики не губляться)
- ✅ `lib/db.ts` pool max 8→4 (Neon conn-ліміт при паралельних кронах)
- 🔧 **Ідемпотентність відправки** — `FOR UPDATE SKIP LOCKED` у сендерах (зараз лише unique-index на event; фізичний дабл-send теоретично можливий при overlap двох крон-запусків)

**Neon 512MB (головний ризик «падіння»):** `pg_database_size` — перша перевірка у space-guard;
url_cache prune кожні 6 год; steady-state prune SC. Зараз ~318MB — здорово.

**Vercel Queues/Workflows (Фаза 2, лише якщо Pro):** нативні ретраї/ідемпотентність/крок-функції
без ліміту тривалості. Зараз overkill для 15 кронів — SKIP LOCKED + watchdog дають 90% надійності дешево.

## Шар 3 — Deliverability (нотатка, користувач деприоритизував)

Ред-флаги 2026 (Google/Yahoo bulk-правила):
- `From: @gmail.com` через Brevo → DMARC-alignment неможливий, Gmail душить spoofing
- Brevo ToS не любить cold email (ризик бану free-акаунта)
- +25%/день warmup задорого; ~30-50/ящик стеля; 280 з одного ящика = ред-флаг

Повний фікс (коли дійдуть руки): окремий outreach-домен + SPF/DKIM/DMARC + RFC 8058
one-click unsubscribe + лінійний warmup +5/день. Потребує домену/DNS — крок користувача.
Безкоштовна частина (RFC 8058 headers, HMAC unsubscribe, тротлінг) — робимо кодом.

## Шар 4 — Безпека (🔧 наступний батч)

- 🔧 auth на `/api/internal/*` (outreach, spotify/*) + `/api/leads/export` (зараз відкриті)
- 🔧 HMAC-підпис brevo webhook (`X-Brevo-Signature`) + вимога TELEGRAM_WEBHOOK_SECRET
- 🔧 HMAC на unsubscribe-токен (зараз base64 email → можна відписати будь-кого)

## План змін (пріоритет)

1. ✅ Розділити крони (ingest-heal / sc-enrich) — прибрати голодування sends
2. ✅ Watchdog self-audit — кінець тихим падінням
3. ✅ brevo-poll cursor-safe + pool sizing
4. 🔧 SKIP LOCKED ідемпотентність у сендерах
5. 🔧 Security hardening (auth + HMAC)
6. 🔧 Deliverability freebies (RFC 8058 unsubscribe headers + HMAC token)
7. ⏸ Deliverability домен + Vercel Pro/Queues — рішення користувача, Фаза 2
