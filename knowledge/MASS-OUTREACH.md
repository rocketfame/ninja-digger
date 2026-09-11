# Масовий канал — рішення і статус

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
- [~] Акаунти: ✅ Elastic Email створено 11.09 (Email API), домен offers.promosound.net верифіковано (SPF/DKIM/CNAME/DMARC), default sender max@offers.promosound.net. SMTP2GO — користувач реєструє (Free зараз, Starter $15 з 2-го тижня). Ще треба від користувача: API-ключ Elastic (вставити в listmonk), ключ SMTP2GO, dedicated IP на Elastic (картка).
- [ ] Hetzner акаунт + SSH-ключ Claude — **користувач**.
- [x] DNS offers.promosound.net — ✅ 11.09: `_dmarc.offers` TXT (p=none, rua dmarc@promosound.net), `offers` TXT SPF `v=spf1 a mx include:_spf.elasticemail.com include:spf.smtp2go.com ~all`, `api._domainkey.offers` TXT (Elastic DKIM), `tracking.offers` CNAME → api.elasticemail.com. Додано через Cloudflare Import (BIND-файл) — надійніше за діалог Add record. Лишилось: DKIM/CNAME від SMTP2GO, Email Routing dmarc@ → infopromosoundgroup@gmail.com.
- [ ] VPS + listmonk (Postgres — окрема база в тому ж Neon-проєкті) + вебхуки bounce/complaint обох провайдерів — Claude. SSH-ключ: ~/.ssh/ninja-mass.pub.
- [~] Міст у коді — Claude. ✅ 11.09: правила циклу в `lib/leadPolicy.ts` (`massEligibleSql`, `MASS_CYCLE`) і в `/api/internal/leads/export` (GET: сегмент за циклом, повторний експорт через 30 днів; POST: `src: listmonk|esputnik`, події в email_events). Лишилось: pull подій із listmonk/провайдерів (вебхуки), стоп-крани у watchdog.
- [~] Три шаблони × 2 варіанти — **верстка переноситься з існуючих eSputnik-розсилок** (✅ витягнуто HTML: LEADS 080926 SoundCloud #4675184, Spotify #4675297, Digest #3 SC #4678492) (витягти HTML через eSputnik API, адаптувати під listmonk: {{ UnsubscribeURL }}, UTM, коди MAX*) — Claude, затвердження користувача.

## Текст для форми SES «Request production access» (не використовується, лишено на випадок повернення до SES)
Use case: Marketing. Website: https://promosoundgroup.net.
Description: PromoSound is a music promotion agency. We email independent artists and producers at the business contact addresses they publish on their public SoundCloud/Spotify/YouTube/Beatport profiles for booking and promotion inquiries, with offers relevant to their platform (e.g. SoundCloud promotion packages to SoundCloud artists). B2B, one relevant offer per recipient per 30 days, expected volume up to 8,000/day after a metric-gated warm-up starting at 500/day.
How we build the list: only public business contacts from artists' own profiles; every address is syntax/MX/SMTP-verified before it enters our base; no purchased lists.
Bounces & complaints: SNS notifications for bounces and complaints are consumed automatically; hard bounces and complaints are suppressed permanently across all our channels within minutes; one-click unsubscribe (RFC 8058) and a visible unsubscribe link in every email; unsubscribes honored immediately. Current metrics on our existing channel: 97% delivery, 1.7% hard bounce, 0% complaints.
