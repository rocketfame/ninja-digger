# Масовий канал — рішення і статус

**ЗМІНА 11.09 (вечір): двигун масового каналу — eSputnik, не listmonk.** Причина: за ті самі $130–150/міс самозбірка (Elastic+listmonk+Hetzner) програє готовій платформі, а eSputnik уже є: акаунт прогрітий, автоматичний прогрів на кожного поштовика, one-click відписка, шаблони, і LEADS-кампанії вони вже пропускають (скарг 0). Elastic Email лишається запасним дротом ($19 Starter, домен верифікований). Hetzner/listmonk — скасовано.

## Як це працює на eSputnik
1. Другий домен відправки `offers.promosound.net` в eSputnik (DNS у Cloudflare: SPF доповнити `include:spf2.esputnik.com`, DKIM CNAME `esputnik._domainkey.offers` → dkim.esputnik.com, tracking-піддомен від eSputnik).
2. Наш крон щодня пушить сегмент у eSputnik через API (bulk upsert контактів + група «SC|Spotify|YouTube <дата>») з правилами циклу з `massEligibleSql`; обсяг — налаштування `esputnik_daily_push` (старт 500, +по метриках).
3. Кампанія в eSputnik на групу: шаблон каналу, лінк колекції, код MAX*, UTM.
4. Крон тягне активність (delivered/open/click/unsub/bounce/complaint) назад у `email_events` (src=esputnik) і в `email_blacklist`.
5. Після циклу (30 днів без реакції) контакт ВИДАЛЯЄТЬСЯ з бази eSputnik — тариф там за контакти, тримаємо 30–50k живих.
6. eSputnik має обмеження прогріву на поштовик (зараз 1000/день/поштовик, рівень 1) — це і є наш природний ramp.

## Код (11.09, задеплоєно)
- `lib/leadBridge.ts` — одна реалізація відбору (`selectMassLeads`, правила циклу з `massEligibleSql`), ledger (`recordHandover` пише lead_exports + подію `sent` src=esputnik) і результатів (`recordOutcome`: email_events + lead_exports.outcome + карантин у blacklist для bounce/spam/unsub). HTTP-міст `/api/internal/leads/export` і крон користуються нею.
- `lib/esputnik.ts` — `pushToEsputnik(platform, limit)`: POST /api/v1/contacts (dedupeOn email, externalCustomerId=email, група `Leads: <Platform> dd.mm.yyyy (auto)`); `pullEsputnikActivity(from,to)`: GET /api/v2/contacts/activity (DELIVERED/READ/CLICKED/UNSUBSCRIBED/SPAM/UNDELIVERED → наш словник, `lib/esputnikStatus.ts`); `retireColdFromEsputnik()`: DELETE /api/v1/contact?externalCustomerId= для тих, кому >30 днів без покупки/негативу → outcome 'cold'.
- `/api/cron/esputnik-sync` щогодини (35 хв): pull → retire → push раз на день. Ручки в app_settings: `esputnik_daily_push` (на платформу, default 0 = ВИМКНЕНО), `esputnik_push_platforms` (default soundcloud,spotify,youtube), курсори `esputnik_poll_since`, `esputnik_last_push_date`.
- Env: `ESPUTNIK_API_KEY` (Basic auth, будь-який user + ключ). Без ключа крон мовчки пропускає.
- Кампанію (лист на групу) запускає користувач в eSputnik або пізніше крон через POST broadcast — після тесту на 500.

Потрібно від користувача: тариф/ліміт контактів eSputnik; додати домен offers.promosound.net в eSputnik і показати DNS-записи; API-ключ eSputnik у Vercel env `ESPUTNIK_API_KEY`.

---
(нижче — попередній план із listmonk, лишено для історії)


Затверджено 11.09.2026. Повний документ: https://claude.ai/code/artifact/15ba38ba-b3f1-4505-acb4-0c36449178f8

## Рішення
- Транспорт (рішення 11.09, після зауваження про сіру нішу): **Elastic Email (з dedicated IP) + SMTP2GO паралельно**, listmonk ротує обидва SMTP. Amazon SES відкинуто: AUP проти unsolicited + ніша плей/фоловери = ймовірна відмова або бан прогрітого IP. Обидва провайдери карають лише метриками (bounce <5%, скарги <0.1%).
- Менеджер кампаній: **listmonk** (Go, AGPL) на Hetzner CX22, за Cloudflare.
- Домен: **offers.promosound.net** — власні SPF/DKIM/DMARC. Не чіпає promosoundgroup.net і персональний promosound.net.
- Наша база — джерело правди: сегмент через `contactableSql()` + ICP → listmonk API; події (open/click/unsub/bounce/complaint) назад у `email_events` (meta.src=listmonk) і `email_blacklist`; кожна віддана адреса — у `lead_exports` (один власник на людину).
- Brevo Free ×3 лишаються для персонального каналу (Reply-To, Approve у боті).

## Правила циклу
- Масовий лист на адресу — не частіше ніж раз на **30 днів**; не раніше ніж через **15 днів** після холодного персонального.
- 3 листи без відкриття поспіль → пауза 60 днів.
- Клік без покупки → нічого; наступний лист через 30 днів.
- Покупка → клієнтський потік на основному сайті, масові стоп.
- Відписка / «не цікаво» → блеклист назавжди, обидва канали.

## Офери (лише наявні колекції, без лендінгів)
| Сегмент | Лінк | Код |
|---|---|---|
| SoundCloud | promosoundgroup.net/collections/s-cloud-promotion | MAXCLOUD |
| Spotify | promosoundgroup.net/collections/spotify-promotion | MAXSPOTIFY |
| YouTube | promosoundgroup.net/collections/youtube-promotion | MAXYOUTUBE |
| Beatport свіжі | **не в масовому каналі** — 1:1 назавжди | — |

UTM у кожному лінку: `utm_source=offers&utm_medium=email&utm_campaign=<сегмент>-<дата>-<варіант>`.

## Розгін — по метриках, не по календарю
500 → 1 000 → 2 000 → 3 500 → 5 000 (managed dedicated IP) → 6 500 → 8 000. Крок лише при bounce <2% і скаргах <0.1%. Стоп-крани у watchdog: скарги ≥0.2% або bounce ≥3% → пауза каналу.
Перший тиждень — свіжі SMTP-перевірені адреси парсера (теплих, що пройшли 15 днів, на 11.09 лише 9). Теплі входять з ~21.09.
Переможець варіанта теми — не раніше ніж по 1 000 листів на варіант.

## Правила 2026 (обов'язкові понад 5k/день)
SPF+DKIM+DMARC на піддомені (DMARC p=none → p=quarantine за місяць); one-click unsubscribe (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058) + посилання в тілі; скарги <0.3% (наш поріг 0.1%); чесна тема; фізична адреса в підвалі; відписка виконується за хвилини.

## Факти, що визначають план
- 7 днів до 11.09: доставка 97.2%, відкриття 28.3%, hard bounce 1.7%, відписки 1.0%, скарги 0, відповіді 1.1%.
- Тест eSputnik 10.09: відкриття 25–35%, кліки 0–0.5% → обсяг не лікує конверсію; спершу формулювання офера.
- Контактабельних: ~98k, приплив ~60k/день з парсера.

## Статус / хто що робить
- [~] Акаунти: ✅ Elastic Email створено 11.09 (Email API), домен offers.promosound.net верифіковано (SPF/DKIM/CNAME/DMARC), default sender max@offers.promosound.net, bounce domain bounces.offers.promosound.net ✅. SMTP2GO — користувач реєструє (Free зараз, Starter $15 з 2-го тижня). Тарифи Elastic Email API (11.09): Free 100/день; Starter $19 = 50k/міс (API+SMTP, tracking, suppressions, БЕЗ вебхуків); Pro $49 = 50k + вебхуки. Рішення: **Starter $19** — bounce/скарги забираємо polling'ом через API (як у Brevo), вебхуки не потрібні. Private IP — add-on, брати з ~3–5k/день. Ще треба від користувача: оплатити Starter, SMTP-credentials Elastic для listmonk, ключ SMTP2GO.
- [ ] Hetzner акаунт + SSH-ключ Claude — **користувач**.
- [x] DNS offers.promosound.net — ✅ 11.09: `_dmarc.offers` TXT (p=none, rua dmarc@promosound.net), `offers` TXT SPF `v=spf1 a mx include:_spf.elasticemail.com include:spf.smtp2go.com ~all`, `api._domainkey.offers` TXT (Elastic DKIM), `tracking.offers` CNAME → api.elasticemail.com, `bounces.offers` CNAME → bounces.elasticemail.net (custom bounce domain Elastic, верифіковано). Додано через Cloudflare Import (BIND-файл) — надійніше за діалог Add record. Лишилось: DKIM/CNAME від SMTP2GO, Email Routing dmarc@ → infopromosoundgroup@gmail.com.
- [ ] VPS + listmonk (Postgres — окрема база в тому ж Neon-проєкті) + вебхуки bounce/complaint обох провайдерів — Claude. SSH-ключ: ~/.ssh/ninja-mass.pub.
- [~] Міст у коді — Claude. ✅ 11.09: правила циклу в `lib/leadPolicy.ts` (`massEligibleSql`, `MASS_CYCLE`) і в `/api/internal/leads/export` (GET: сегмент за циклом, повторний експорт через 30 днів; POST: `src: listmonk|esputnik`, події в email_events). Лишилось: pull подій із listmonk/провайдерів (вебхуки), стоп-крани у watchdog.
- [~] Три шаблони × 2 варіанти — **верстка переноситься з існуючих eSputnik-розсилок** (✅ витягнуто HTML: LEADS 080926 SoundCloud #4675184, Spotify #4675297, Digest #3 SC #4678492) (витягти HTML через eSputnik API, адаптувати під listmonk: {{ UnsubscribeURL }}, UTM, коди MAX*) — Claude, затвердження користувача.

## Текст для форми SES «Request production access» (не використовується, лишено на випадок повернення до SES)
Use case: Marketing. Website: https://promosoundgroup.net.
Description: PromoSound is a music promotion agency. We email independent artists and producers at the business contact addresses they publish on their public SoundCloud/Spotify/YouTube/Beatport profiles for booking and promotion inquiries, with offers relevant to their platform (e.g. SoundCloud promotion packages to SoundCloud artists). B2B, one relevant offer per recipient per 30 days, expected volume up to 8,000/day after a metric-gated warm-up starting at 500/day.
How we build the list: only public business contacts from artists' own profiles; every address is syntax/MX/SMTP-verified before it enters our base; no purchased lists.
Bounces & complaints: SNS notifications for bounces and complaints are consumed automatically; hard bounces and complaints are suppressed permanently across all our channels within minutes; one-click unsubscribe (RFC 8058) and a visible unsubscribe link in every email; unsubscribes honored immediately. Current metrics on our existing channel: 97% delivery, 1.7% hard bounce, 0% complaints.
