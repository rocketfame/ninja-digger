/**
 * GET /api/cron/report-hourly — hourly DISCOVERY pulse to Telegram.
 * Priority is lead-finding: per platform, new leads (🔍) + emails (📧) found in
 * the last hour. Sending is secondary (one compact line). Finding should never
 * be zero except the exceptions we agreed (Spotify on IG-detox; a genuinely
 * quiet SC harvest minute).
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

  const H = "interval '1 hour'";
  const row = await pool
    .query(
      `SELECT
        -- new leads found (last hour)
        (SELECT COUNT(DISTINCT artist_beatport_id) FROM artist_contacts WHERE type='email' AND created_at > now() - ${H}) bp_leads,
        (SELECT COUNT(*) FROM sc_artists    WHERE created_at    > now() - ${H}) sc_leads,
        (SELECT COUNT(*) FROM spotify_leads WHERE created_at    > now() - ${H}) sp_leads,
        (SELECT COUNT(*) FROM radar_leads   WHERE created_at    > now() - ${H}) rd_leads,
        -- emails found (last hour)
        (SELECT COUNT(*) FROM artist_contacts WHERE type='email' AND created_at > now() - ${H}) bp_mail,
        (SELECT COUNT(*) FROM sc_artists    WHERE email_found_at > now() - ${H}) sc_mail,
        (SELECT COUNT(*) FROM spotify_leads WHERE email_found_at > now() - ${H}) sp_mail,
        (SELECT COUNT(*) FROM radar_leads   WHERE email_found_at > now() - ${H}) rd_mail,
        -- sends (last hour)
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'email_touch_%' AND sent_at > now() - ${H}) bp_sent,
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'sc_touch_%'    AND sent_at > now() - ${H}) sc_sent,
        (SELECT COUNT(*) FROM outreach_events WHERE template_id LIKE 'sp_touch_%'    AND sent_at > now() - ${H}) sp_sent,
        (SELECT COUNT(*) FROM radar_leads) rd_total`
    )
    .then((r) => r.rows[0] ?? {})
    .catch(() => ({} as Record<string, unknown>));

  const r = row as Record<string, unknown>;
  const hour = new Date().getUTCHours();
  const night = hour < 6 || hour > 20;
  const find = (name: string, leads: unknown, mail: unknown) => `${name} — 🔍 ${n(leads)} · 📧 ${n(mail)}`;

  const lines = [
    `📊 <b>Знайдено за годину</b>`,
    find("Beatport", r.bp_leads, r.bp_mail),
    find("SoundCloud", r.sc_leads, r.sc_mail),
    find("Spotify", r.sp_leads, r.sp_mail),
  ];
  if (n(r.rd_total) > 0) lines.push(find("Radar", r.rd_leads, r.rd_mail));
  lines.push("──");
  lines.push(
    night
      ? `📤 надіслано: 🌙 ніч, відправка на паузі до 06:00 UTC`
      : `📤 надіслано: BP ${n(r.bp_sent)} · SC ${n(r.sc_sent)} · SP ${n(r.sp_sent)}`
  );

  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return NextResponse.json({ ok: true, row: r, ts: new Date().toISOString() });
}
