/**
 * GET /api/cron/brevo-poll — pull transactional email events from the Brevo API
 * (opens/clicks/bounces/unsub) into our engagement funnel. Robust alternative
 * to a webhook. No-ops until BREVO_API_KEY is set in the environment.
 * Feeds the same columns as /api/brevo/webhook so the "gold" base scores from it.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BrevoEvent = { email?: string; event?: string; date?: string };

async function getSetting(key: string, fb: string) {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key]).then((r) => r.rows[0]?.value ?? fb).catch(() => fb);
}
async function setSetting(key: string, value: string) {
  await pool.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]).catch(() => {});
}

async function apply(email: string, event: string) {
  const e = event.toLowerCase();
  await pool.query(`INSERT INTO email_events (email, event, meta) VALUES ($1,$2,'{"src":"poll"}')`, [email, e]).catch(() => {});
  if (e === "delivered") {
    await pool.query(`UPDATE sc_artists SET delivered_at=COALESCE(delivered_at,now()), email_status=CASE WHEN email_status IN ('engaged','bounced','unsub') THEN email_status ELSE 'delivered' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
  } else if (e === "opened" || e === "uniqueopened" || e === "click" || e === "clicks") {
    const isClick = e.startsWith("click");
    await pool.query(`UPDATE sc_artists SET opens=opens+${isClick ? 0 : 1}, clicks=clicks+${isClick ? 1 : 0}, first_open_at=COALESCE(first_open_at,now()), email_status=CASE WHEN email_status IN ('bounced','unsub') THEN email_status ELSE 'engaged' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
  } else if (e === "hardbounces" || e === "hard_bounce" || e === "blocked" || e === "invalid" || e === "error") {
    await pool.query(`UPDATE sc_artists SET email_status='bounced', lead_status='Bounced', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
  } else if (e === "unsubscribed" || e === "spam") {
    await pool.query(`UPDATE sc_artists SET email_status='unsub', lead_status='Unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`INSERT INTO email_blacklist (email, reason) VALUES ($1,'brevo:'||$2) ON CONFLICT DO NOTHING`, [email, e]).catch(() => {});
  }
}

export async function GET() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return NextResponse.json({ ok: true, skipped: "no BREVO_API_KEY" });

  // Poll a rolling window (last 2 days), deduped by email_events (idempotent-ish).
  const since = (await getSetting("brevo_poll_since", "")) || new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const startDate = since.slice(0, 10);
  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  let processed = 0;
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const url = `https://api.brevo.com/v3/smtp/statistics/events?limit=500&offset=${offset}&startDate=${startDate}&endDate=${endDate}&sort=desc`;
    const res = await fetch(url, { headers: { "api-key": key, accept: "application/json" } }).catch(() => null);
    if (!res || !res.ok) break;
    const data = (await res.json().catch(() => ({}))) as { events?: BrevoEvent[] };
    const events = data.events ?? [];
    if (events.length === 0) break;
    for (const ev of events) {
      if (ev.email && ev.event) { await apply(ev.email.trim().toLowerCase(), ev.event); processed++; }
    }
    if (events.length < 500) break;
    offset += 500;
  }
  await setSetting("brevo_poll_since", new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10));
  return NextResponse.json({ ok: true, processed, ts: new Date().toISOString() });
}
