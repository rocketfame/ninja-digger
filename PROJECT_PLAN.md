# Ninja Digger — Project Plan

## Overview

Deterministic data-research tool for Beatport-related artists, DJs, and labels (manual outreach support).

**Stack:** Next.js (App Router), Vercel, Postgres. One external data source at a time (chart mirrors first; Songstats optional later).

**Core principles:**
- SQL is the source of truth
- Deterministic pipelines over AI reasoning
- LLMs are optional helpers, never core logic
- Manual-first outreach support
- Minimal infrastructure, minimal cost

### Hybrid data ingestion (global rule)

**The system uses a hybrid data ingestion model.**

- **Primary data source:** Public chart mirrors and aggregators (no API, no contracts)
- **Secondary (optional) data source:** Enterprise APIs (e.g. Songstats), pluggable later without refactoring
- **Rule:** All ingestion sources must implement the same normalized output schema.

### BP Top Tracker & Beatstats = Beatport data (global rule)

**BP Top Tracker and Beatstats are services that pull data directly from Beatport** (via API or equivalent, implicitly). They have been doing this for a long time and have done the heavy lifting. **We treat their data as Beatport-derived:** we ingest and process their information (charts, artists, positions) and use it for our pipeline. We do not need to scrape Beatport directly for this—these aggregators are our primary source for chart/artist data from the Beatport ecosystem. This is fixed project context: remember it in all design and implementation decisions.

Cursor must follow this plan strictly. No phase skipping. No premature optimization. No “helpful” deviations.

---

## Phase 0 — Project Skeleton (Foundation)

### Goal
Create a clean, stable project structure before any business logic.

### Scope
- Next.js app initialization
- Environment variables setup
- Database connection
- Base folders (empty, predefined)

### Deliverables
- Working Next.js app
- `.env.example`
- DB connection utility
- Folder structure: /ingest, /normalize, /segment, /enrich, /lib, /app/leads, /app/artist

### Definition of Done
- App runs locally
- Database connection works
- No ingestion, no logic, no UI yet

### Rules
- No data models
- No APIs
- No LLM usage

---

## Phase 1 — Data Model (Schema First)

### Goal
Define and lock the core data model. Source of truth for the entire system.

### Core Tables
- artists, tracks, labels, chart_entries, sources, lead_scores, artist_notes

### Deliverables
- SQL schema
- Migrations
- Minimal seed data (1–2 test artists)

### Definition of Done
- All tables exist
- Relationships are defined
- Sample SELECT queries work
- Schema is considered stable

### Rules
- No ingestion allowed before this phase is DONE
- No UI
- No enrichment
- No LLM

---

## Phase 2 — Data Ingestion (Hybrid: Chart Mirrors First)

### Goal
Ingest Beatport-related chart data without relying on enterprise APIs.

### Primary Strategy (MVP)
Use public chart mirrors and aggregators to collect:
- Chart entries
- Artist names
- Track names
- Labels
- Chart position
- Date snapshot

### Secondary Strategy (Future, Optional)
Support pluggable ingestion adapters for enterprise APIs (e.g. Songstats), without changing core logic.

### Scope (MVP)
- One or more public chart mirrors
- Daily ingestion via scheduled jobs
- Snapshot-based storage (append-only)

### Deliverables
- `/ingest/sources/chart_mirror_*.ts` (e.g. beatport)
- Unified ingestion interface (`IngestionSource`, `ChartEntryInput`)
- Raw chart_entries inserts
- Source metadata tracking

### Definition of Done
- Daily chart snapshots are stored
- Multiple sources can coexist
- No dependency on external API approval

### Rules
- No normalization in this phase
- No segmentation
- No LLM usage

**Rule for Cursor:** Any new data source must implement `IngestionSource`. No source is allowed to write directly to DB.

---

## Phase 3 — Normalization (Source-Agnostic)

### Goal
Normalize artists, tracks, and labels across multiple ingestion sources.

### Scope
- Merge entities from different sources
- Handle naming inconsistencies
- Maintain source references

### Deliverables
- Normalized artist IDs
- Source-aware relations
- Clean chart history per entity

### Definition of Done
- One logical artist can have multiple sources
- Source data is preserved
- Normalized views are stable

### Rules
- SQL-only logic
- No AI
- No enrichment

**Important:** One artist can come from chart mirror, Songstats (later), or any other source. Hybrid model is built here.

---

## Phase 4 — Segmentation & Scoring (Multi-Signal SQL)

### Goal
Segment artists based on chart behavior across all sources.

### Signals
- Chart frequency
- Average position
- Entry recency
- Momentum (delta over time)
- Source diversity (optional signal)

### Segments
- core, regular, fresh, momentum, flyers

### Deliverables
- SQL views for segments
- Lead scoring formula
- Explainable segmentation logic

### Definition of Done
- Segments update automatically
- New sources do not require refactoring
- Scores are deterministic

### Rules
- No LLM
- No UI logic

---

## Phase 5 — Minimal Research UI

### Goal
Make the data usable for human decision-making.

### UI Features
- Leads table
- Filters by segment / score
- Artist detail page
- Chart history view
- Manual notes

### Deliverables
- /app/leads page
- /app/artist/[id] page
- Read-only analytics + notes

### Definition of Done
- Leads can be browsed and filtered
- Artist history is visible
- Notes can be added and saved

### Rules
- No automation
- No enrichment required
- UI stays minimal

---

## Phase 6 — Enrichment (Hybrid, Optional)

### Goal
Add contextual insights without affecting core logic.

### Enrichment Sources
- Public UI data (bios, profiles)
- Optional enterprise APIs (later)
- Optional LLM-based summarization

### Rules
- Enrichment is non-blocking
- Enrichment can be disabled entirely
- Core system must work without it

### Definition of Done
- Enrichment stored separately
- No dependency on enrichment for segmentation

---

## Phase 7 — Outreach Support (Manual-First)

### Goal
Prepare leads for human outreach, not automate it.

### Features
- Outreach status
- Contact fields
- Readiness flags
- CSV export

### Deliverables
- Outreach fields in DB
- Export functionality
- Simple status tracking

### Definition of Done
- Leads can be marked and exported
- Manual outreach workflow is supported
- No messages are sent automatically

### Rules
- No auto-DM
- No auto-email
- Human remains in control

---

## Global Rules (Anti-Chaos)

1. No phase skipping
2. No AI in core logic
3. SQL is the source of truth
4. Each phase must be explicitly marked DONE
5. Cursor must not introduce new features outside the current phase
6. No speculative optimization
7. **Hybrid ingestion:** chart mirrors first; enterprise APIs (e.g. Songstats) are optional plug-ins.

---

## Reference: Chart mirrors & signals

### Primary (core)
**Beatport Charts (public web)**  
- Top 100 by genre, Hype charts, Release charts  
- Signals: chart_type (top / hype / release), genre, position, chart_date, artist_name, track_title, label_name

### Secondary (momentum + intent)
**1001Tracklists**  
- DJ support, track appearance frequency, fresh DJ adoption  
- Signals: first_seen_date, support_count, recent_support_delta, dj_tier (optional)

### Optional (validation)
**Traxsource charts** — validation / enrichment, especially house / soulful / afro.

### Not used (by design)
- Spotify / TikTok numbers, Instagram followers, streaming metrics — too noisy for Beatport-focused outreach.

---

## Reference: Ingestion interface (TypeScript)

```ts
// ingest/types.ts

export interface ChartEntryInput {
  source: string;               // beatport | traxsource | tracklists
  chartType: string;            // top100 | hype | release | dj_support
  genre: string | null;
  position: number | null;
  chartDate: string;            // YYYY-MM-DD
  artistName: string;
  trackTitle: string;
  labelName?: string | null;
  externalIds?: { beatportId?: string; tracklistsId?: string };
}

export interface IngestionSource {
  sourceName: string;
  fetchEntries(date: string): Promise<ChartEntryInput[]>;
}
```

**Rule:** Any new data source must implement `IngestionSource`. No source writes directly to DB.

---

## Reference: Scoring formula (hybrid, explainable)

**Signals:** A = appearances, P = avg_position, R = recency (days since last entry), M = momentum (position delta over 7 days), S = source_diversity.

**Lead score (example):**
```
score = (A * 2) + (100 - P) + max(0, 30 - R) + (M * 3) + (S * 5)
```

**Segments:**
- CORE: A ≥ 10 and P ≤ 30
- REGULAR: A ≥ 5
- FRESH: first_seen ≤ 14 days
- MOMENTUM: M > 0
- FLYER: else

---

## Що ми реально будуємо (людською мовою)

Не “інтеграцію з Songstats”, а **Digger Engine**, де:
- джерела = змінні
- логіка = стабільна
- SQL = центр
- API = плагін, не основа

**Сьогодні:** Chart mirrors = основне паливо, SQL = сегментація, UI = ресерч.

**Завтра (якщо захочеш):** підключаєш Songstats — він просто ще один source, жодної перебудови системи.
