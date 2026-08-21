/**
 * GET /api/cron/report-hourly — minimal hourly pulse to Telegram.
 * Exactly two numbers per platform: sends and emails found in the last hour.
 * No other detail by design.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const n = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? 0), 10) || 0);

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await pool
    .query(
      `SELECT
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'email_touch_%' AND sent_at > now() - interval '1 hour') bp_sent,
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'sc_touch_%'    AND sent_at > now() - interval '1 hour') sc_sent,
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'sp_touch_%'    AND sent_at > now() - interval '1 hour') sp_sent,
        (SELECT COUNT(*) FROM artist_contacts WHERE type='email' AND created_at > now() - interval '1 hour') bp_mail,
        (SELECT COUNT(*) FROM sc_artists WHERE email IS NOT NULL AND enrich_attempted_at > now() - interval '1 hour') sc_mail,
        (SELECT COUNT(*) FROM spotify_leads WHERE email IS NOT NULL AND enriched_at > now() - interval '1 hour') sp_mail`
    )
    .then((r) => r.rows[0] ?? {})
    .catch(() => ({} as Record<string, unknown>));

  const r = row as Record<string, unknown>;
  const line = (name: string, sent: unknown, mail: unknown) => `${name} — 📤 ${n(sent)} · 📧 ${n(mail)}`;
  const msg =
    `📊 <b>Щогодинний</b>\n` +
    line("Beatport", r.bp_sent, r.bp_mail) + "\n" +
    line("SoundCloud", r.sc_sent, r.sc_mail) + "\n" +
    line("Spotify", r.sp_sent, r.sp_mail);

  await sendTelegramMessage(msg).catch(() => {});
  return NextResponse.json({ ok: true, row: r, ts: new Date().toISOString() });
}
