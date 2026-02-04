# Ninja Digger

Deterministic data-research tool for Beatport-related artists, DJs, and labels (manual outreach support).

**Stack:** Next.js (App Router), Vercel, Postgres, Songstats (Phase 2).

---

## Phase 0 — Foundation ✓

- Next.js app (App Router)
- Environment: copy `.env.example` → `.env`, set `DATABASE_URL`
- DB: `lib/db.ts` — `pool`, `query()`, `checkConnection()`
- Folders: `ingest`, `normalize`, `segment`, `enrich`, `lib`, `app/leads`, `app/artist`

### Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Verify database connection

Set `DATABASE_URL` in `.env`, then from any server-side code:

```ts
import { checkConnection } from "@/lib/db";
const ok = await checkConnection(); // true if connected
```

No APIs, no data models, no UI beyond the placeholder home page.
