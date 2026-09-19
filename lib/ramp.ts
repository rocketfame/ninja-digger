/**
 * Domain warm-up as a ladder the cron climbs on its own (user, 18.09:
 * "щоби ніде нічого не відпало, а лагідно і плавно працювало").
 *
 * The lesson of 15–17.09 (knowledge/MASS-OUTREACH.md): volume is raised
 * only on evidence, at most every `stepDays`, and every step is small.
 * Each Kyiv day, before the cycle fills, `applyRamp()` reads yesterday's
 * outcome and decides one of three things:
 *   STOP    — a hard limit was crossed → esputnik_daily_push = 0, a human
 *             turns it back on (delete esputnik_ramp_stopped).
 *   HOLD    — a soft gate failed, or a human set esputnik_ramp_hold=1 after
 *             reading Postmaster → same volume as yesterday.
 *   CLIMB   — the level has run its `stepDays` and every gate passed → next
 *             rung of the ladder.
 * The decision itself is a pure function (`rampDecision`) so it is unit-tested.
 *
 * Knobs (app_settings):
 *   esputnik_ramp            JSON {start, steps[], stepDays, hours} — empty = ramp off
 *   esputnik_ramp_level      current rung (index into steps)
 *   esputnik_ramp_level_since  Kyiv day the rung started
 *   esputnik_ramp_hold       "1" = do not climb today (manual, e.g. Postmaster not fresh)
 *   esputnik_ramp_stopped    ISO timestamp of the stop-cord pull; present = stay at 0
 *   esputnik_ramp_day        last Kyiv day the ramp ran (idempotence)
 * It writes esputnik_daily_push, esputnik_batch_per_hour and esputnik_engagement.
 */
import { pool } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";

import { rampDecision, type DayMetrics, type PostmasterMetrics, type RampConfig, type RampDecision } from "@/lib/rampPolicy";
import { latestTrafficStats, postmasterConfigured } from "@/lib/postmaster";
export { GATES, gateVerdict, rampDecision } from "@/lib/rampPolicy";
export type { DayMetrics, RampConfig, RampDecision } from "@/lib/rampPolicy";

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);

const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
const kyivHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(d));

/** Outcome of the groups broadcast on `day` (Kyiv), each measured 24 h after its start. */
export async function dayMetrics(day: string): Promise<DayMetrics | null> {
  const r = await pool.query<Record<string, string>>(
    `WITH g AS (
       SELECT group_name, scheduled_at FROM mass_groups
        WHERE broadcast_id IS NOT NULL AND broadcast_id <> -1
          AND (scheduled_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date),
     b AS (SELECT le.email, g.scheduled_at FROM lead_exports le JOIN g ON g.group_name = le.batch)
     SELECT COUNT(DISTINCT b.email) pushed,
       COUNT(DISTINCT e.email) FILTER (WHERE e.event = 'delivered') delivered,
       COUNT(DISTINCT e.email) FILTER (WHERE e.event IN ('opened','uniqueopened','click')) opened,
       COUNT(DISTINCT e.email) FILTER (WHERE e.event = 'hard_bounce') hard_bounce,
       COUNT(DISTINCT e.email) FILTER (WHERE e.event = 'unsubscribed') unsub,
       COUNT(DISTINCT e.email) FILTER (WHERE e.event = 'spam') spam
     FROM b LEFT JOIN email_events e ON e.email = b.email AND (e.meta->>'src') = 'esputnik'
       AND e.ts >= b.scheduled_at AND e.ts < b.scheduled_at + interval '24 hours'`, [day]);
  const x = r.rows[0];
  if (!x || Number(x.pushed) === 0) return null;
  return { pushed: +x.pushed, delivered: +x.delivered, opened: +x.opened, hardBounce: +x.hard_bounce, unsub: +x.unsub, spam: +x.spam };
}

function parseCfg(raw: string): RampConfig | null {
  try {
    const c = JSON.parse(raw) as Partial<RampConfig>;
    if (!c || !Array.isArray(c.steps) || !c.start) return null;
    return { start: c.start, steps: c.steps.map(Number).filter((n) => n > 0), stepDays: Number(c.stepDays) || 2, hours: Number(c.hours) || 8 };
  } catch { return null; }
}

/** Runs once per Kyiv day; sets the day's volume from the ladder. Returns what it decided. */
/**
 * Has the ladder decided today's volume yet? While a ramp is configured, the
 * cycle must not fill before it has — otherwise the first run after midnight
 * fills on yesterday's number.
 */
export async function rampDecidedToday(now = new Date()): Promise<boolean> {
  const cfg = parseCfg(await getSetting("esputnik_ramp", ""));
  if (!cfg || kyivDay(now) < cfg.start) return true; // no ramp → nothing to wait for
  return (await getSetting("esputnik_ramp_day", "")) === kyivDay(now);
}

export async function applyRamp(now = new Date()): Promise<RampDecision & { skipped?: boolean }> {
  const today = kyivDay(now);
  const cfg = parseCfg(await getSetting("esputnik_ramp", ""));
  if (!cfg) return { action: "off", reason: "esputnik_ramp не заданий", skipped: true };
  if ((await getSetting("esputnik_ramp_day", "")) === today) return { action: "off", reason: "сьогодні вже вирішено", skipped: true };
  // Yesterday's letter went out at esputnik_send_hour and was spread over
  // `hours`; judging it at 00:35 would see a third of its opens. Decide at
  // esputnik_ramp_decide_hour (Kyiv, default 13) — 21 h after a 16:00 send,
  // still ahead of today's send.
  const decideHour = parseInt(await getSetting("esputnik_ramp_decide_hour", "13"), 10) || 13;
  if (kyivHour(now) < decideHour && today > cfg.start) return { action: "off", reason: `рішення о ${decideHour}:00 Київ`, skipped: true };

  const level = parseInt(await getSetting("esputnik_ramp_level", "0"), 10) || 0;
  const levelSince = (await getSetting("esputnik_ramp_level_since", "")) || null;
  const yesterday = kyivDay(new Date(now.getTime() - 86_400_000));
  const metrics = await dayMetrics(yesterday).catch(() => null);
  // Gmail's own verdict on the sending domain (esputnik_sender_domain), newest day it has published
  const domain = await getSetting("esputnik_sender_domain", "psg-offers.com");
  let pmNote = "Postmaster: не підключено";
  let postmaster: PostmasterMetrics | null = null;
  if (postmasterConfigured()) {
    try {
      postmaster = await latestTrafficStats(domain, 4, now);
      pmNote = postmaster
        ? `Postmaster ${postmaster.date}: скарги ${postmaster.spamRatio === null ? "—" : (100 * postmaster.spamRatio).toFixed(2) + " %"}, auth ${postmaster.authRatio === null ? "—" : (100 * postmaster.authRatio).toFixed(0) + " %"}, errors ${(100 * postmaster.deliveryErrorRatio).toFixed(1)} %${postmaster.needsWork.length ? ", needs work: " + postmaster.needsWork.join(", ") : ", compliance OK"}${postmaster.verdict ? ", вердикт " + postmaster.verdict : ""}`
        : `Postmaster: ${domain} ще без даних`;
    } catch (e) { pmNote = `Postmaster: помилка — ${e instanceof Error ? e.message : String(e)}`; }
  }
  const d = rampDecision({
    cfg, today, level, levelSince,
    stopped: Boolean(await getSetting("esputnik_ramp_stopped", "")),
    manualHold: (await getSetting("esputnik_ramp_hold", "0")) === "1",
    metrics, postmaster,
  });
  if (d.action === "off") return d;

  await setSetting("esputnik_ramp_day", today);
  if (d.action === "stop") {
    await setSetting("esputnik_daily_push", "0");
    if (!(await getSetting("esputnik_ramp_stopped", ""))) await setSetting("esputnik_ramp_stopped", now.toISOString());
  } else {
    if (d.action === "climb" || d.action === "start") { await setSetting("esputnik_ramp_level", String(d.level)); await setSetting("esputnik_ramp_level_since", today); }
    await setSetting("esputnik_daily_push", String(d.push));
    await setSetting("esputnik_batch_per_hour", String(Math.ceil(d.push / cfg.hours)));
    // the first two rungs go to people who already opened our mail — the domain's first impression
    await setSetting("esputnik_engagement", d.level < 2 ? "engaged" : "any");
  }
  const m = metrics ? `вчора: ${metrics.pushed} → доставлено ${metrics.delivered}, відкрито ${metrics.opened} (${pct(metrics.opened, metrics.delivered).toFixed(1)} %), bounce ${metrics.hardBounce}, відписки ${metrics.unsub}, скарги ${metrics.spam}` : "вчора: даних нема";
  const icon = d.action === "stop" ? "⛔" : d.action === "climb" ? "📈" : d.action === "start" ? "🚀" : "⏸";
  await sendTelegramMessage(`${icon} ${domain} ramp, сходинка ${d.level + 1}/${cfg.steps.length}: ${d.action.toUpperCase()} → ${d.push}/день\n${d.reason}\n${m}\n${pmNote}`).catch(() => {});
  return d;
}
