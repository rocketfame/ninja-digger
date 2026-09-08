# Що працює автоматично — і як це вимкнути

Інвентар усього, що запускається без людини. Оновлювати при додаванні/видаленні автоматизації.

---

## 1. Крони на Vercel (сервер, працюють завжди)

**Джерело правди:** `vercel.json`, секція `crons`. Зараз 20 записів.

```bash
python3 -c "import json;[print(f\"{c['schedule']:<16} {c['path']}\") for c in json.load(open('vercel.json'))['crons']]"
```

| Що | Розклад (UTC) |
|---|---|
| `daily` — чарти BPTT + нормалізація + прибирання | 05:14 |
| `ingest-heal` — самолікування інжесту чартів | 07:08, 09:08, 11:08 |
| `pipeline` — відправка Beatport | щогодини :00 |
| `inbox` — читання пошти, відповіді лідів, чернетки | кожні 5 хв |
| `sc-outreach` / `spotify-outreach` / `radar-outreach` | :10 / :40 / :48 |
| `soundcloud` — харвест фоловерів із сідів | :22, :52 |
| `sc-enrich` / `radar-enrich` / `spotify-crawl` — пошук email | :05,:35 / :12 / :15 |
| `youtube-radar` / `reddit-radar` — нові ліди | :50 / 08:20, 20:20 |
| `brevo-poll` — доставка/опени/баунси | :25 |
| `watchdog` — самоперевірка + алерти в Telegram | кожні 3 год :30 |
| `hygiene` — тижнева гігієна бази + VACUUM | нд 06:40 |
| `report-hourly` + звіти в Telegram | :58, 08:00, 18:00 |

**Як вимкнути одну задачу:** прибрати її блок із `crons` у `vercel.json` → `git push` (Vercel застосує на наступному деплої).
**Як вимкнути відправку, не чіпаючи код:** перемикачі в БД, миттєво, без деплою —
`UPDATE app_settings SET value='1' WHERE key IN ('outreach_paused','sc_outreach_paused','sp_outreach_paused','radar_outreach_paused');`
(`'0'` — увімкнути назад). Або поставити акаунт у `sender_blocklist`.

---

## 2. Локальні агенти launchd (працюють, лише коли Mac увімкнений)

**Подивитися все своє:**
```bash
ls -la ~/Library/LaunchAgents/          # файли
launchctl list | grep -i "promosound\|ninjadigger"   # що реально завантажено
```
У колонках `launchctl list`: PID (`-` = зараз не виконується), код останнього виходу, назва.

**Вимкнути / видалити будь-який:**
```bash
launchctl unload ~/Library/LaunchAgents/<назва>.plist   # зупинити
rm ~/Library/LaunchAgents/<назва>.plist                 # прибрати назовсім
```

### Стан на 2026-09-08

| Агент | Проєкт | Стан |
|---|---|---|
| `com.promosound.refresh-bestsellers` | Shopify-воркспейс | завантажений, працює |
| `com.promosound.theme-drift` | Shopify-воркспейс | завантажений, працює |
| `com.promosound.cleanup-orders` | Shopify-воркспейс | завантажений |
| `com.promosound.newsscan` | Shopify-воркспейс | завантажений |
| `com.ninjadigger.verify-queue` | **цей проєкт** | **НЕ встановлений** — лежить у `scripts/`, ставиться вручну |

Чотири `com.promosound.*` належать іншому воркспейсу (Shopify-менеджер), не цьому репозиторію.

### verify-queue (перевірка скриньок по SMTP)
Не встановлений. Порт 25 заблокований на Vercel і Cloudflare, тому це єдина річ, яку не можна винести на сервер.

```bash
# увімкнути щоденний запуск о 03:20
cp scripts/com.ninjadigger.verify-queue.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ninjadigger.verify-queue.plist

# вимкнути
launchctl unload ~/Library/LaunchAgents/com.ninjadigger.verify-queue.plist
rm ~/Library/LaunchAgents/com.ninjadigger.verify-queue.plist

# лог
tail -f /tmp/ninjadigger-verify.log
```
Без нього перевірку запускають руками: `npx tsx scripts/verify-queue.mjs 3000` (`DRY=1` — прев'ю).

---

## 3. Ручні скрипти (нічого не запускають самі)

| Скрипт | Навіщо |
|---|---|
| `scripts/verify-queue.mjs` | SMTP-перевірка скриньок у черзі |
| `scripts/scrub-junk-emails.mjs` | скраб бази за junk-політикою |
| `scripts/crawl-contacts.mjs` | пошук email на лінках Spotify-лідів |
| `scripts/rewind-blackout-sends.mjs` | повернення лідів у чергу після збою доставки |
| `scripts/migrate.mjs` | міграції (виконується автоматично у `npm run build`) |

## 4. Cron / crontab
Порожній. Нічого не використовує.
