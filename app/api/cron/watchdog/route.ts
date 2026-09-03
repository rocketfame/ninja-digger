/**
 * GET /api/cron/watchdog — the system watches itself.
 * Reads existing tables to infer health and pings Telegram ONLY when something
 * is actually wrong (no daily noise). This is the safety net that turns "it
 * silently stopped for days" into "we knew within hours". Runs a few times/day.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? 0), 10) || 0);

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const one = async (sql: string) => pool.query(sql).then((r) => r.rows[0] ?? {}).catch(() => ({} as Record<string, unknown>));
  const alerts: string[] = [];

  // 1. DB space — the thing that once killed ingestion. Warn well before the cap.
  const size = await one(`SELECT pg_database_size(current_database())/1024/1024 AS mb`);
  const mb = num((size as { mb?: unknown }).mb);
  if (mb >= 480) alerts.push(`🔴 БД ${mb}MB / 512 — критично близько до ліміту (прун/вакуум!)`);

  // 2. Sends in the last 24h per channel. Night is fine, but a full day of zero
  //    on a channel with a non-empty queue means the sender is broken.
  const sends = await one(`
    SELECT
      COUNT(*) FILTER (WHERE template_id LIKE 'email_touch_%') bp,
      COUNT(*) FILTER (WHERE template_id LIKE 'sc_touch_%') sc,
      COUNT(*) FILTER (WHERE template_id LIKE 'sp_touch_%') sp
    FROM outreach_events WHERE channel='email' AND sent_at > now() - interval '24 hours'`);
  const paused = await one(`SELECT
      (SELECT value FROM app_settings WHERE key='outreach_paused') bp,
      (SELECT value FROM app_settings WHERE key='sc_outreach_paused') sc,
      (SELECT value FROM app_settings WHERE key='sp_outreach_paused') sp`);
  const queues = await one(`SELECT
      (SELECT COUNT(*) FROM artist_contacts ac WHERE ac.type='email' AND (ac.status IS NULL OR ac.status='ok')) bpq,
      (SELECT COUNT(*) FROM sc_artists WHERE email IS NOT NULL AND (sc_touch IS NULL OR sc_touch=0) AND is_active) scq,
      (SELECT COUNT(*) FROM spotify_leads WHERE email IS NOT NULL AND (sp_touch IS NULL OR sp_touch=0)) spq`);
  const chk = (name: string, sent: unknown, isPaused: unknown, q: unknown) => {
    if (String(isPaused) === "1") return; // intentionally paused — not a fault
    if (num(sent) === 0 && num(q) > 0) alerts.push(`🔴 ${name}: 0 відправок за 24год, а в черзі ${num(q)} — сендер зламався?`);
  };
  chk("Beatport", (sends as Record<string, unknown>).bp, (paused as Record<string, unknown>).bp, (queues as Record<string, unknown>).bpq);
  chk("SoundCloud", (sends as Record<string, unknown>).sc, (paused as Record<string, unknown>).sc, (queues as Record<string, unknown>).scq);
  chk("Spotify", (sends as Record<string, unknown>).sp, (paused as Record<string, unknown>).sp, (queues as Record<string, unknown>).spq);
  // Radar (YouTube/Reddit) barrel — was the only sender nobody watched.
  const radar = await one(`SELECT
      (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'radar_touch_%' AND sent_at > now() - interval '24 hours') sent,
      (SELECT value FROM app_settings WHERE key='radar_outreach_paused') paused,
      (SELECT COUNT(*) FROM radar_leads WHERE email IS NOT NULL AND COALESCE(touch,0)=0 AND COALESCE(status,'new') IN ('new','queued')) q`);
  chk("Radar", (radar as Record<string, unknown>).sent, (radar as Record<string, unknown>).paused, (radar as Record<string, unknown>).q);

  // 2b. Chart freshness — the condition ingest-heal exists for. If both the
  //     daily pull (05:14) and the heal windows (07/09/11) failed, say so.
  if (new Date().getUTCHours() >= 12) {
    const ch = await one(`SELECT COUNT(*) c FROM bptoptracker_daily WHERE snapshot_date >= CURRENT_DATE - 1`);
    if (num((ch as { c?: unknown }).c) === 0) alerts.push(`🔴 Beatport-чарти: нема знімка за сьогодні/вчора — daily та ingest-heal не спрацювали`);
  }

  // 3. New emails in the last 24h — the exact failure that started this. BP
  //    contacts + SC enrichment must be producing. (Spotify is browser-driven,
  //    so a quiet night there is expected — not alerted.)
  const bpNew = await one(`SELECT COUNT(*) c FROM artist_contacts WHERE type='email' AND created_at > now() - interval '24 hours'`);
  if (num((bpNew as { c?: unknown }).c) === 0) alerts.push(`🟠 Beatport: 0 нових email-контактів за 24год — enrich/інжест стоїть?`);
  const scAttempt = await one(`SELECT COUNT(*) c FROM sc_artists WHERE enrich_attempted_at > now() - interval '2 hours'`);
  if (num((scAttempt as { c?: unknown }).c) === 0) alerts.push(`🟠 SoundCloud: sc-enrich не працював 2год — крон стоїть?`);

  // 3b. SC HARVEST yield — the engine that feeds everything. A healthy harvest
  //     does ~1-2k followers/run; near-zero over 3h means seeds are exhausted
  //     (need refuel), the cron is timing out, or SoundCloud broke. This is the
  //     exact class of failure that kept slipping through unnoticed.
  const scHarvest = await one(`SELECT COUNT(*) c FROM sc_artists WHERE harvested_at > now() - interval '3 hours'`);
  const scDue = await one(`SELECT COUNT(*) c FROM sc_seed_accounts WHERE active AND (completed_at IS NULL OR (priority>=2 AND completed_at<now()-interval '5 days') OR (priority<2 AND completed_at<now()-interval '14 days'))`);
  const due = num((scDue as { c?: unknown }).c);
  if (num((scHarvest as { c?: unknown }).c) < 100) {
    alerts.push(`🔴 SoundCloud: харвест майже стоїть (${num((scHarvest as { c?: unknown }).c)} фоловерів за 3год)${due < 50 ? ` — сіди вичерпані (due ${due}), треба дозаправку` : ` — крон падає/таймаутить (due ${due})`}`);
  }
  // Proactive Re-Ex refuel warning — fire BEFORE the harvest collapses, while the
  // last fresh seeds are still being worked, so there's time to collect more.
  else if (due < 60) {
    alerts.push(`🟠 Re-Ex база вигорає — лишилось ${due} свіжих сідів. Час зібрати нових рекламодавців з repostexchange.com/engage (я зроблю збір браузером).`);
  }

  // 4. Brevo poll freshness — engagement metrics feed the "gold/diamond" tiers.
  const poll = await one(`SELECT value FROM app_settings WHERE key='brevo_poll_since'`);
  const pollDate = String((poll as { value?: unknown }).value ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (process.env.BREVO_API_KEY && pollDate && pollDate < yest) {
    alerts.push(`🟠 brevo-poll застряг на ${pollDate} (сьогодні ${today}) — метрики не оновлюються`);
  }

  // 5. DELIVERY BLACKOUT — the failure that hid for 4 days (2026-08-30..09-03):
  //    the SMTP relay accepted every message but Brevo delivered none. Compare
  //    what WE handed to Brevo yesterday with what BREVO says it delivered
  //    (aggregated report, primary account). The raw report is persisted in
  //    app_settings so it can be inspected without dashboard credentials.
  if (process.env.BREVO_API_KEY) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/statistics/reports?days=4", {
        headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { reports?: { date: string; requests: number; delivered: number; hardBounces: number; softBounces: number; blocked: number; opens: number }[] };
      const rows = body.reports ?? [];
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('brevo_daily_report', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ status: res.status, rows, ts: new Date().toISOString() }).slice(0, 4000)]
      ).catch(() => {});
      const y = rows.find((r) => r.date === yest);
      const ours = await one(`SELECT COUNT(*) c FROM outreach_events WHERE channel='email' AND template_id LIKE '%\_touch\_%' AND COALESCE(sender,'brevo1')='brevo1' AND sent_at >= CURRENT_DATE - 1 AND sent_at < CURRENT_DATE`);
      const sentY = num((ours as { c?: unknown }).c);
      if (res.ok && sentY >= 20) {
        const deliv = y ? num(y.delivered) : 0;
        const req = y ? num(y.requests) : 0;
        if (req < sentY * 0.5) alerts.push(`🔴 Brevo НЕ БАЧИТЬ наші листи: вчора віддали brevo1 ${sentY}, Brevo зафіксував requests=${req} — акаунт заблоковано/ключ не той?`);
        else if (deliv < req * 0.5) alerts.push(`🔴 Brevo доставив лише ${deliv} з ${req} (blocked=${num(y?.blocked)}, hb=${num(y?.hardBounces)}) — репутація/блок акаунта`);
      } else if (!res.ok) {
        alerts.push(`🟠 Brevo API звіт недоступний (HTTP ${res.status}) — перевір BREVO_API_KEY`);
      }
    } catch (e) {
      alerts.push(`🟠 Brevo delivery check впав: ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`);
    }
  }

  if (alerts.length > 0) {
    await sendTelegramMessage(`🐕 <b>WATCHDOG</b> — знайдено проблеми:\n\n${alerts.join("\n")}`).catch((e) => console.error("[watchdog] telegram failed:", e instanceof Error ? e.message : e));
  }

  return NextResponse.json({ ok: true, dbMb: mb, alerts, healthy: alerts.length === 0, ts: new Date().toISOString() });
}
