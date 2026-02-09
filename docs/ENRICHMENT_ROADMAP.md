# Enrichment Pipeline — Master Prompt Set (Roadmap + ТЗ)

Фінальний набір Cursor-prompt'ів для всіх фаз enrichment. Виконувати поетапно.

---

## 🔰 PHASE 0 — FOUNDATION (вирівнювання логіки)

**Goal:** Prepare the system for phased enrichment by aligning data flow, priorities, and UI expectations.

**Tasks:**
- Ensure enrichment can be triggered:
  - from a Segment page ("Run Enrichment")
  - from an Artist profile card ("Run Enrichment")
- Ensure enrichment runs are tracked with statuses: queued / running / completed / partial / failed
- Ensure enrichment never blocks UI and always fails gracefully.

**Acceptance:**
- Enrichment trigger buttons exist and work.
- Enrichment status is visible in UI.
- No new sources added yet.

---

## 🟢 PHASE 1 — PRIORITY & CROSS-VALIDATION (NO NEW SOURCES)

**Goal:** Improve accuracy and trust by prioritizing authoritative sources and cross-validating links and contacts.

**Source priority (fixed order):**
1. Linktree / Beacons / Carrd
2. Resident Advisor
3. SoundCloud
4. Bandcamp
5. Mixcloud
6. Reverb Nation
7. Instagram

**Key logic:**
- For each artist: run discovery in the above order.
- For each source: exactly ONE search query (quoted artist name), fetch up to 2 candidate URLs, validate with nameMatches (normalized artist name, slug, username).
- **Cross-validation:** If SoundCloud or Resident Advisor or Linktree page contains external links → extract them, validate with nameMatches, auto-confirm matching Instagram / Linktree / Website links.
- **Email extraction:** ONLY from Linktree, Resident Advisor, SoundCloud, Bandcamp. Each email must include source_type, source_url, confidence score.

**Confidence scoring (baseline):**
- Resident Advisor: 0.95
- Linktree: 0.90
- Bandcamp: 0.85
- SoundCloud: 0.80
- Instagram bio: 0.70

**UI:**
- Artist card: links in priority order; emails sorted by confidence with label "via {source}".
- No clutter, icons + tooltip.

**Acceptance:**
- After enrichment, artist cards show links and emails in correct order.
- Cross-confirmed links appear even if not directly searched.
- No direct "email scraping from search engines".

---

## 🟡 PHASE 2 — TIKTOK + WEBSITE (CONTROLLED EXPANSION)

**Goal:** Expand coverage while keeping accuracy and low noise.

**New source types:** TikTok, Official Website.

- **TikTok:** Search "ARTIST NAME" site:tiktok.com; extract profile URL, bio, link in bio. Not a primary email source; use to confirm identity and extract Linktree/Website.
- **Website:** From extracted links or fallback "ARTIST NAME official website". Accept emails only from contact/footer/about; high confidence only if artist name matches site identity.

**UI:** TikTok icon in artist card; Website last in link order.

**Acceptance:** TikTok links when confidently matched; website emails only when clearly official; no increase in false positives.

---

## 🔵 PHASE 3 — MONITORING, RATE CONTROL, STABILITY

**Goal:** Observable, safe, scalable enrichment.

**Tasks:**
- Enrichment run logs: search engine used, queries, URLs fetched, rejection reasons (name mismatch, low confidence).
- Configurable rate limits: max requests per artist, delay between fetches.
- Engine fallback: DDG → Bing → Startpage.
- Timeout handling and retries.

**UI:** Optional admin debug view with run summary per artist.

**Acceptance:** No hard-fails; logs explain why data was or wasn't found; rate limits prevent aggressive crawling.

---

## ⚪ PHASE 4 — OFFICIALITY & CONTACT INTELLIGENCE (OPTIONAL)

**Goal:** Differentiate generic vs booking/management contacts.

- New contact types: booking_email, management_email, label_contact (if detected).
- Detect keywords near email: booking, mgmt, management, bookings, agency.
- Boost confidence if email on RA or official website, or domain matches artist brand.
- UI: Label emails (Booking / Management / General); allow user to mark preferred contact.

**Acceptance:** Best outreach-ready contact visible; confidence reflects officiality.

---

## 🧠 GLOBAL RULES (ALL PHASES)

- No headless browsers.
- No paid APIs by default.
- No bulk scraping.
- Max 10–15 HTTP requests per artist per run.
- All enrichment manually triggered (no silent background crawling).
- All extracted data must include source + confidence.

---

## ✅ FINAL RESULT

- 1-клік enrichment після сегмента
- Крос-перевірені соцмережі
- Email тільки з офіційних джерел
- Зрозуміла картка артиста
- Готовність до outreach без сорому
