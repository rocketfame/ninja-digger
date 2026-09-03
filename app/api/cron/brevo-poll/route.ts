/**
 * GET /api/cron/brevo-poll — pull transactional email events from the Brevo API
 * (delivered/opens/clicks/bounces/unsub) into our engagement funnel for EVERY
 * configured Brevo account (primary BREVO_API_KEY + any OUTREACH_SENDERS entry
 * that carries an `apiKey`). Idempotent: events are keyed by (email, event,
 * Brevo event timestamp) with a unique index, so re-polling the same window is
 * a no-op and counters only move for genuinely new events.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getSenders } from "@/lib/outreachSenders";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type BrevoEvent = { email?: string; event?: string; date?: string };

async function getSetting(key: string, fb: string) {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key]).then((r) => r.rows[0]?.value ?? fb).catch(() => fb);
}
async function setSetting(key: string, value: string) {
  await pool.query(`INSERT INTO app_settings (key,value,updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, value]).catch(() => {});
}

/** Record one event; returns true only when it was NEW (not seen before). */
async function record(email: string, event: string, date: string | undefined, account: string): Promise<boolean> {
  const ts = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : new Date();
  return pool
    .query(`INSERT INTO email_events (email, event, ts, meta) VALUES ($1,$2,$3,$4) ON CONFLICT (email, event, ts) DO NOTHING`, [email, event, ts, JSON.stringify({ src: "poll", account })])
    .then((r) => (r.rowCount ?? 0) > 0)
    .catch((e) => { console.error("[brevo-poll] insert failed:", e instanceof Error ? e.message : e); return false; });
}

async function apply(email: string, event: string) {
  const e = event.toLowerCase();
  if (e === "delivered") {
    await pool.query(`UPDATE sc_artists SET delivered_at=COALESCE(delivered_at,now()), email_status=CASE WHEN email_status IN ('engaged','bounced','unsub') THEN email_status ELSE 'delivered' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE spotify_leads SET delivered_at=COALESCE(delivered_at,now()), email_status=CASE WHEN email_status IN ('engaged','bounced','unsub') THEN email_status ELSE 'delivered' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE artist_contacts SET delivered_at=COALESCE(delivered_at,now()) WHERE type='email' AND LOWER(TRIM(value))=$1`, [email]).catch(() => {});
  } else if (e === "opened" || e === "uniqueopened" || e === "click" || e === "clicks") {
    const isClick = e.startsWith("click");
    await pool.query(`UPDATE sc_artists SET opens=opens+${isClick ? 0 : 1}, clicks=clicks+${isClick ? 1 : 0}, first_open_at=COALESCE(first_open_at,now()), email_status=CASE WHEN email_status IN ('bounced','unsub') THEN email_status ELSE 'engaged' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE spotify_leads SET opens=opens+${isClick ? 0 : 1}, clicks=clicks+${isClick ? 1 : 0}, first_open_at=COALESCE(first_open_at,now()), email_status=CASE WHEN email_status IN ('bounced','unsub') THEN email_status ELSE 'engaged' END, updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    if (!isClick) await pool.query(`UPDATE artist_contacts SET opens=opens+1, first_open_at=COALESCE(first_open_at,now()) WHERE type='email' AND LOWER(TRIM(value))=$1`, [email]).catch(() => {});
  } else if (e === "hardbounces" || e === "hard_bounce" || e === "blocked" || e === "invalid" || e === "error") {
    await pool.query(`UPDATE sc_artists SET email_status='bounced', lead_status='Bounced', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE spotify_leads SET email_status='bounced', lead_status='Bounced', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE radar_leads SET email_status='bounced', status='dead', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE artist_contacts SET status='bounced' WHERE type='email' AND LOWER(TRIM(value))=$1`, [email]).catch(() => {});
  } else if (e === "unsubscribed" || e === "spam") {
    await pool.query(`UPDATE sc_artists SET email_status='unsub', lead_status='Unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE spotify_leads SET email_status='unsub', lead_status='Unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE radar_leads SET email_status='unsub', status='unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    await pool.query(`UPDATE artist_contacts SET status='blocked' WHERE type='email' AND LOWER(TRIM(value))=$1`, [email]).catch(() => {});
    await pool.query(`INSERT INTO email_blacklist (email, reason) VALUES ($1,'brevo:'||$2) ON CONFLICT DO NOTHING`, [email, e]).catch(() => {});
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // One API key per Brevo account. Deduped so the same key isn't polled twice.
  const accounts: { id: string; key: string }[] = [];
  if (process.env.BREVO_API_KEY) accounts.push({ id: "brevo1", key: process.env.BREVO_API_KEY });
  // Extra accounts as plain env vars: BREVO_API_KEY_<ID> (e.g. BREVO_API_KEY_BREVO2).
  for (const k of Object.keys(process.env).filter((x) => x.startsWith("BREVO_API_KEY_")).sort()) {
    const v = process.env[k];
    if (v && !accounts.some((a) => a.key === v)) accounts.push({ id: k.slice("BREVO_API_KEY_".length).toLowerCase(), key: v });
  }
  for (const s of getSenders()) if (s.apiKey && !accounts.some((a) => a.key === s.apiKey)) accounts.push({ id: s.id, key: s.apiKey });
  if (accounts.length === 0) return NextResponse.json({ ok: true, skipped: "no Brevo API keys" });

  // Rolling window: from (cursor − 2 days) to today. Brevo records bounces
  // against the ORIGINAL send date, so the window must reach back past the
  // cursor; dedup makes the overlap free.
  const since = (await getSetting("brevo_poll_since", "")) || new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(since.slice(0, 10)) - 2 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10); // Brevo rejects future dates
  const deadline = Date.now() + 100_000; // stay under maxDuration

  let processed = 0, fresh = 0, failed = false;
  const debug: Record<string, unknown> = {};
  for (const acc of accounts) {
    let offset = 0;
    for (let page = 0; page < 40; page++) {
      if (Date.now() > deadline) { failed = true; debug.timeout = acc.id; break; }
      const url = `https://api.brevo.com/v3/smtp/statistics/events?limit=500&offset=${offset}&startDate=${startDate}&endDate=${endDate}&sort=desc`;
      const res = await fetch(url, { headers: { "api-key": acc.key, accept: "application/json" } }).catch((e) => { debug.fetchErr = `${acc.id}: ${String(e)}`; return null; });
      if (!res) { failed = true; break; }
      if (!res.ok) { debug.status = `${acc.id}: HTTP ${res.status}`; debug.body = (await res.text().catch(() => "")).slice(0, 200); failed = true; break; }
      const data = (await res.json().catch(() => ({}))) as { events?: BrevoEvent[] };
      const events = data.events ?? [];
      if (events.length === 0) break;
      for (const ev of events) {
        if (!ev.email || !ev.event) continue;
        const email = ev.email.trim().toLowerCase();
        const event = ev.event.toLowerCase();
        processed++;
        if (await record(email, event, ev.date, acc.id)) { fresh++; await apply(email, event); }
      }
      if (events.length < 500) break;
      offset += 500;
    }
  }
  // Only advance the cursor when the whole window was pulled without error —
  // otherwise a transient Brevo failure would silently skip events forever.
  if (failed) {
    await sendTelegramMessage(
      `⚠️ <b>brevo-poll збій</b> — метрики (опени/баунси) не підтягнулись, курсор НЕ зсунуто (повтор наступного циклу).\n<code>${JSON.stringify(debug).slice(0, 300)}</code>`
    ).catch(() => {});
    return NextResponse.json({ ok: false, failed: true, processed, fresh, debug, ts: new Date().toISOString() }, { status: 500 });
  }
  await setSetting("brevo_poll_since", endDate);
  return NextResponse.json({ ok: true, accounts: accounts.map((a) => a.id), window: [startDate, endDate], processed, fresh, ts: new Date().toISOString() });
}
