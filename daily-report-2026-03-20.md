# Ninja Digger — Daily Outreach Report
**Date:** 2026-03-20 (Friday)

---

## Pipeline Overview

| Metric | Value |
|---|---|
| Total contacts found | 186 |
| Qualified emails (conf ≥ 0.65) | 131 |
| New emails (last 24h) | 6 |
| Unique chart artists tracked | 7,961 |
| Enriched artist profiles | 0 |

## Lead Profiles by Status

| Status | Count |
|---|---|
| Attempt 1 | 54 |
| Attempt 2 | 24 |
| No Response | 20 |
| Contacted | 9 |
| **Total in pipeline** | **107** |

## Outreach Events (All Time: 102)

| Template | Sent |
|---|---|
| Touch 1 | 38 |
| Touch 2 | 44 |
| Touch 3 | 20 |

### Today's Cron Run
Cron triggered successfully. Result: **0 new sends** across all touches. No leads were queued for sending — pipeline may need new leads enriched & loaded.

### Today's Automated Events
| Channel | Outcome | Count |
|---|---|---|
| Email | Attempt 2 | 40 |
| Email | No Response | 20 |

## Lead Scoring Segments

| Segment | Leads | Avg Score |
|---|---|---|
| NEW_ENTRY | 9,372 | 0.7 |
| CONSISTENT | 7,572 | 1.5 |
| TOP_PERFORMER | 2,206 | 2.5 |
| FAST_GROWING | 849 | 3.7 |
| DECLINING | 631 | 1.7 |
| NEWCOMER | 234 | 1.5 |

## Genres Covered (Top 10 by unique artists)

Electronica, Amapiano, Ambient/Experimental, Electro (Classic/Detroit/Modern), Caribbean, Bass/Club, Global, Rock, Downtempo, African

## Social Links Found

| Platform | Count |
|---|---|
| Bandcamp | 595 |
| Facebook | 590 |
| Mixcloud | 562 |
| SoundCloud | 562 |
| Instagram | 512 |
| Linktree | 380 |
| Website | 193 |
| Twitter | 44 |
| Resident Advisor | 25 |

## Replies & Hot Leads
- **Replies in DB:** 0
- **Hot leads:** 0
- **Gmail check:** Timed out — manual check recommended (mail.google.com/mail/u/4/#inbox)

## Issues & Notes
1. **Cron sent 0 emails today** — all 3 touches returned 0 queued. Likely all existing leads have already been touched. Need to enrich new artists to refill the pipeline.
2. **0 enriched artist profiles** — the `artist_enrichment` table is empty. Bio/insight enrichment hasn't been run yet.
3. **Last discovery run** was 2026-02-07 (41 days ago). Fresh discovery run recommended to pull new chart entries and score new leads.
4. **Gmail timeout** — Chrome extension timed out reading the inbox. Check manually for artist replies.

## Recommended Actions
- Run a fresh discovery + enrichment cycle to load new leads into the outreach pipeline
- Enrich top FAST_GROWING segment artists (849 leads, avg score 3.7) — highest ROI
- Check Gmail manually for any artist replies to Promosound emails
- Consider re-engaging "No Response" leads (20) with a different angle
