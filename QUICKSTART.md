# Як запустити Ninja Digger

## 1. Встанови залежності

```bash
npm install
```

## 2. База даних (Postgres)

Потрібна база Postgres (локально або в хмарі: [Neon](https://neon.tech), [Supabase](https://supabase.com), [Vercel Postgres](https://vercel.com/storage/postgres) тощо).

- Отримай **connection string** (URL підключення), наприклад:
  `postgresql://user:password@host:5432/database?sslmode=require`

## 3. Налаштуй .env

```bash
cp .env.example .env
```

Відкрий `.env` і встав **тільки** рядок з базою:

```
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

(Підстав свої `user`, `password`, `host`, `database`.)

Решту змінних можна поки не заповнювати.

## 4. Запусти міграції

Один раз виконай міграції, щоб створити таблиці:

```bash
npm run db:migrate
```

Має з’явитися список міграцій і в кінці: «Міграції виконано.»

## 5. Запусти додаток

```bash
npm run dev
```

Відкрий у браузері: **http://localhost:3000**

- Головна → посилання на Leads  
- **Leads** — спочатку буде порожньо; після першого щоденного cron (або ручного виклику `/api/cron/daily`) з’являться артисти.

---

## Якщо деплоїш на Vercel

1. Пуш проєкту на GitHub і підключи репо до Vercel.
2. У Vercel → **Project → Settings → Environment Variables** додай:
   - `DATABASE_URL` — твій Postgres connection string  
   - `CRON_SECRET` — будь-який довгий секрет (наприклад згенерований пароль), щоб захистити cron.
3. Міграції на проді: підключися до тієї ж бази і локально виконай `npm run db:migrate` (у тебе в .env вже буде `DATABASE_URL` від прод-бази), **або** один раз викликай скрипт міграції з машини, де є доступ до цієї бази.
4. Після деплою **нічого викликати вручну не потрібно** — Vercel щодня о 6:00 UTC викличе `/api/cron/daily` (discovery раз на тиждень + ingest + normalize + score).

---

## Швидка перевірка

- Відкрив **http://localhost:3000** → бачу головну.  
- Відкрив **http://localhost:3000/leads** → бачу Leads (порожній список або повідомлення про DATABASE_URL — значить .env не підключено).  
- Після `npm run db:migrate` і налаштованого `DATABASE_URL` сторінка Leads має відкриватися без помилки.
