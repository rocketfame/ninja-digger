# Session handoff — 21.09.2026 (Lisbon 17:15 / Kyiv 19:15)

Read this first in a new session. It says where we stopped and what to do next.

## State right now

**Everything on Max's personal Brevo channel is PAUSED** (all four crons: `outreach_paused`, `sc_outreach_paused`, `sp_outreach_paused`, `radar_outreach_paused` = 1). Reason: Google Postmaster shows the parent domain `promosound.net` as **Not compliant** (user-reported spam ≥ 0.3 %) — caused by the Brevo cold outreach 08–13.09 (~900/day, 60 % Gmail). Inbox reply detection (IMAP → Telegram) still runs.

**Mass channel (eSputnik, `offers.promosound.net`) is in warm-up / diagnostic mode:**

| knob (app_settings) | value | meaning |
|---|---|---|
| `esputnik_daily_push` | 1000 | per platform per cycle (0 = off) |
| `esputnik_max_cycles_per_day` | 1 | |
| `esputnik_push_platforms` | soundcloud | Spotify dead, YouTube `valid` exhausted (164 left) |
| `esputnik_sc_source` | reex | Re-Ex advertisers only (`nonreex` = graph/upload, `any`) |
| `esputnik_send_hour` | 16 | Kyiv; 0 = send the moment the group is filled |
| `esputnik_ceiling` | 24500 | hard ceiling of the eSputnik base — never raise |
| `esputnik_poll_cursor` | ISO ts | resumable activity pull (2 h overlap) |
| `mass_pending_fills` | [] | async imports waiting to settle |

Today (16.09) went out as **1 000 in two shots**: `Leads: SoundCloud 16.09.2026 (auto)` 476 (broadcast 4532505, 16:00 Kyiv, 474 delivered) + `/2 (auto)` 524 (broadcast 4533059, 18:38 Kyiv, 522 delivered, 0 refused after the name fix). Both groups already deleted from eSputnik. The top-up was done through the cron with temporary knobs (daily_push=524, max_cycles=2, send_hour=0), knobs restored to 1000 / 1 / 16 afterwards — this is the way to fill a shortfall the same day.

Yesterday's cycles 2 (4 585) and 3 (4 716) are fully delivered and deleted from eSputnik.


## 17.09 — decision: mass channel moves to psg-offers.com

Postmaster (data to 15.09): promosound.net spam 2–5.17 % on 08–12.09 (Brevo), Not compliant (spam rate + From alignment). offers.promosound.net: complaints 0 %, but 15.09 **42.6 % rejected by Gmail as "Suspected spam"**, auth 58 %; opens 4 % → 1 %. Subdomain inherits the parent → warm-up on offers is futile. Full write-up + lessons + ramp: `knowledge/MASS-OUTREACH.md` (top section).

Done today: broadcast 4533201 (17.09, 1 000) cancelled, group deleted from eSputnik (998 + 2 customers detached), ledger released; `esputnik_daily_push=0`; **user is buying `psg-offers.com`** in Cloudflare Registrar (tab left open). **Day-0 done 17.09 ~13:40 Kyiv** (Cloudflare zone `f6decaac628e151bebf02575be4ab994`): SPF/DKIM/send-subdomain/DMARC/google-site-verification/esputnik-verification TXT; Email Routing on, rule `max@psg-offers.com → inbox`; **Postmaster Verified**; eSputnik domain added (FULL_PLUS, `verificationPassed: true`, status IN_PROGRESS — "up to 24 h, usually much less"). Code: `esputnik_batch_per_hour` knob deployed.
**Done 17.09 17:50 Kyiv:** eSputnik domain CONFIGURED (~4 h after TXT); sender "Max from Promosound <max@psg-offers.com>" added and confirmed (confirmation mail arrived through Email Routing → read via IMAP with GMAIL_USER creds, link opened); message **4690375** = byte-identical clone of 4681093 with the new sender; `esputnik_message_soundcloud=4690375` (old offers template 4681093 kept). Then 48 h pause from DNS (earliest first send 19.09 16:00 Kyiv): `esputnik_daily_push=100`, `esputnik_batch_per_hour=25`, `esputnik_sc_source=reex`, and the ramp with gates from MASS-OUTREACH.md. Also open: who sends unaligned From @promosound.net (Postmaster "From: header alignment — Needs work"); Brevo stays paused.


## 18.09 — ramp automated, start tomorrow

Strategy doc (artifact): https://claude.ai/code/artifact/66eac0d7-68b2-42ec-9572-ef9b333f927a. User decisions: keep template 4690375 as is (no A/B during warm-up), 21-day ladder OK, engagement-first OK, stop rules OK, own link domain — done (`click.psg-offers.com`, SSL by eSputnik).
Code deployed: `lib/ramp.ts` + `lib/rampPolicy.ts` (tests) wired at the top of `advance()`; `esputnik_engagement` knob with fallback in `fillGroup`. Knobs set: `esputnik_ramp` (start 2026-09-19, 11 rungs, 2 days each, 8 h), level 0, `daily_push=0` until the ramp starts it, `sc_source=reex`, `engagement=engaged`, `send_hour=16`.
**Tomorrow 19.09**: first cron after 00:00 Kyiv runs applyRamp → START 100/day (batch 13/h), fill, broadcast 16:00 Kyiv → Telegram "🚀". Postmaster is read by the cron itself (v2 API, OAuth done 18.09) — no daily human task; `esputnik_ramp_hold=1` stays as a manual override. Warm pool is only ~105 addresses — day 2+ is Re-Ex tier A.
Closed 18.09: the "From alignment" flag is residue of the 15–16.09 Gmail rejections on offers (DMARC 58 % on 15.09), no third-party sender — see MASS-OUTREACH.md. Brevo stays paused. Postmaster is automated: ramp gate + daily digest for all 4 domains (Telegram).


## 19.09 — ramp day 1 (psg-offers.com)

START 100/day fired at 00:35: group `Leads: SoundCloud 19.09.2026 (auto)`, broadcast 4536221 16:00 Kyiv, 13/h. Two bugs found and fixed the same evening (deployed): (1) the cron deleted the group at 21:35 with 48 contacts still queued (≥50 % delivered rule ignored batching) → deletion now waits for the full send window; the 48 were released back to the pool (ledger + events), `members` corrected to 52; (2) the ladder judged yesterday at 00:35 = 8.5 h after a 16:00 send → decision now at 13:00 Kyiv (`esputnik_ramp_decide_hour`), fill waits for it. Day-1 truth: 52 sent, 52 delivered, **0 opens by 22:00 Kyiv** (eSputnik analytics). If still < 4 % at 13:00 on 20.09 the gate will STOP — then read Postmaster for psg-offers.com (first data expected 21.09) before deciding anything.


## 21.09 — the ladder had stopped itself; rule changed, resumed

20.09 13:36 the gate pulled STOP on day 1 (52 delivered, 2 opens = 3.8 % < 4 %); 20–21.09 nothing went out. Postmaster for psg-offers.com 19.09: auth 100 %, spam 0, rejections 0 — no harm signal. User: "воно має працювати постійно". Rule changed and deployed: STOP only on spam ≥ 0.1 %, bounce > 4 %, Postmaster errors > 5 %; low opens/unsubs → HOLD; a day under 150 delivered is not judged. Resumed at rung 1 (100/day, 13/h, level_since 21.09); the fill ran 21.09 evening → broadcast 22.09 16:00 Kyiv. Watchdog: Re-Ex seeds down to 24 — harvest from repostexchange in Chrome next session (memory reex-refuel-proactive). promosoundgroup.net had 0 % auth days again on 17.09 and 20.09 (low-volume days; likely a mailbox sending as @promosoundgroup.net outside SPF/DKIM) — source still unknown, no harm yet.


## 22.09 — audiences for the PPC manager (Meta)

Exported to `scratchpad/ppc/` (gitignored) + `scratchpad/ppc_audiences_2026-09-22.zip` (2.4 MB). Filters everywhere: valid syntax, not in email_blacklist, not a shop customer (prospecting lists must not contain clients). Tiers: 1 hot (replied/clicked) 85 · 2 warm (opened) 2 128 · 3 delivered-no-reaction (valid) 15 671 · 4 clean-untouched ICP (SMTP valid, tier A/B, ≥100 followers) 131 487 · 5 shop customers 64 363 (buyers 15 275, repeat 5 074, 60-day buyers 557 with spend). Recommendation given: value-based lookalike from 5a buyers; interest lookalike from 1+2 (+3 as a second seed); 4 = direct custom audience (expect 30–50 % Meta match); exclude 5 from prospecting. Re-export = `npx tsx scratchpad/segexport.ts` + `scratchpad/shopexport.ts` (temp table needs one connection — segment 4 count comes from the file).

## Open questions to close next session

1. ~~Why does eSputnik refuse ~half of the Re-Ex import?~~ **CLOSED 16.09 14:xx** — eSputnik's `firstName` validator drops the whole contact: ≤ 40 chars, ≤ 3 words, no symbols, a dot only at the end of a ≤ 3-char word ("Jr."). SoundCloud names ("D o n K r e z", "Gabe Reed & SteezDeeez Founder, Composer, Producer") fail en masse. Fix deployed (`d87985e`): `cleanFirstName` now fits the validator (383 of the 524 keep a name, 141 go nameless, 0 addresses lost), and `fillGroup` re-pushes any `failedContacts` without a name. Verified against the live API with 14 hard names — all accepted. The 524 were released back to the pool and will be picked up by the next fill.
2. **Read rate of the 16:00 warm-up** — compare at 18:00 Kyiv with the baseline: cycle 2 had ~40 reads in the first 40 min / 2.4 % in 24 h; cycle 3 (after the reputation hit) 0.7 %. Below ~0.4 % in 2 h = Gmail spam folder → keep volume low.
3. **Postmaster tomorrow (17.09)**: `promosound.net` was added and verified today (TXT via Cloudflare zone `c43b6e23088a066145dd117dbdd49a80`). The daily spam-rate / domain reputation graphs appear after the next daily update. Also check `offers.promosound.net`. Full pace (3 cycles × ~4 600) only when promosound.net is Compliant and reads ≥ ~2 %.
4. **Plan B** if promosound.net does not recover within ~a week: a separate domain for offers, unrelated to promosound.net (user buys it; DNS + eSputnik + 7-day warm-up is ours).

## Money (as of 16.09)

All shop orders since 15.07 (1 381) matched against every touch: personal channel $157.70 (1 buyer, 12 orders), mass $18.90 (1 buyer). 21 977 leads touched in total. Mass channel is too young to judge (9 641 of its 15 622 touches were on 15.09).

## Lead base (16.09)

SoundCloud 1 484 963 profiles / 232 821 with email / 168 742 `valid` / **103 675 ready** (valid + untouched + ICP); Re-Ex subset ready 7 530, graph/upload 100 601. YouTube 164 ready, Spotify 1. Warm base (touched) 21 608: hot 36 · warm 1 488 · cold 19 215 · blacklist 833.

## Lessons written into memory today

- `mass-valid-only` — mass channel only on `verdict = 'valid'`; `unknown` bounced 17 %, `catch_all` 7 %.
- `gmail-reputation-2026-09` — the incident, timeline, and the rule: check Postmaster daily before raising volume.

## Code landed today (all deployed, on main)

- `lib/esputnikStatus.ts` + `lib/massCycle.ts` (14:xx): eSputnik-safe first names + nameless retry of refused contacts (see closed question 1).
- `lib/massCycle.ts`: async import per eSputnik docs (push → `mass_pending_fills` → settle via `/v1/importstatus`), top-up to the ceiling within the open cycle, broadcast after fill, deletes 10 in flight, per-platform quota per cycle, `esputnik_sc_source` knob, refusal logging.
- `lib/esputnik.ts`: activity API is Europe/Kyiv (windows and timestamps), full-minute windows fetched whole (broadcast minutes exceed 1 000 rows), resumable cursor.
- `lib/leadBridge.ts`: `valid` only; `scSource` filter.
- `app/api/internal/esputnik/purge/route.ts`: no longer releases the ledger (it wiped 340 sent leads on 15.09 — restored from eSputnik activity).
- CLAUDE.md rules 7–8 (background servers, single-run tests).

## How to operate

- Manual cron trigger: from a Chrome tab on ninja-digger.vercel.app: `fetch('/api/cron/esputnik-sync', {credentials:'include'})` after `DELETE FROM app_settings WHERE key='lease:esputnik-sync'`.
- Group/cycle state: `scratchpad/cyc.ts` printed `name members broadcast scheduled delivered [DELETED]` from `mass_groups` — recreate with a one-liner over `mass_groups` if the scratchpad is gone.
- Deploy: `npm run build && git push && npx vercel --prod --yes` (git auto-deploy lags).
