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

  // 3. New emails in the last 24h — the exact failure that started this. BP
  //    contacts + SC enrichment must be producing. (Spotify is browser-driven,
  //    so a quiet night there is expected — not alerted.)
  const bpNew = await one(`SELECT COUNT(*) c FROM artist_contacts WHERE type='email' AND created_at > now() - interval '24 hours'`);
  if (num((bpNew as { c?: unknown }).c) === 0) alerts.push(`🟠 Beatport: 0 нових email-контактів за 24год — enrich/інжест стоїть?`);
  const scAttempt = await one(`SELECT COUNT(*) c FROM sc_artists WHERE enrich_attempted_at > now() - interval '2 hours'`);
  if (num((scAttempt as { c?: unknown }).c) === 0) alerts.push(`🟠 SoundCloud: sc-enrich не працював 2год — крон стоїть?`);

  // 4. Brevo poll freshness — engagement metrics feed the "gold/diamond" tiers.
  const poll = await one(`SELECT value FROM app_settings WHERE key='brevo_poll_since'`);
  const pollDate = String((poll as { value?: unknown }).value ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (process.env.BREVO_API_KEY && pollDate && pollDate < yest) {
    alerts.push(`🟠 brevo-poll застряг на ${pollDate} (сьогодні ${today}) — метрики не оновлюються`);
  }

  if (alerts.length > 0) {
    await sendTelegramMessage(`🐕 <b>WATCHDOG</b> — знайдено проблеми:\n\n${alerts.join("\n")}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, dbMb: mb, alerts, healthy: alerts.length === 0, ts: new Date().toISOString() });
}
