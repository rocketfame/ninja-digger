/**
 * GET /api/cron/report-hourly — hourly email-discovery pulse to Telegram.
 * ONE number per platform: emails found in the last hour. Nothing else.
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
  const r = (await pool
    .query(
      `SELECT
        (SELECT COUNT(*) FROM artist_contacts WHERE type='email' AND created_at > now() - ${H}) bp,
        (SELECT COUNT(*) FROM sc_artists    WHERE email_found_at > now() - ${H}) sc,
        (SELECT COUNT(*) FROM spotify_leads WHERE email_found_at > now() - ${H}) sp,
        (SELECT COUNT(*) FROM radar_leads   WHERE email_found_at > now() - ${H}) rd,
        (SELECT COUNT(*) FROM radar_leads) rd_total`
    )
    .then((x) => x.rows[0] ?? {})
    .catch(() => ({}))) as Record<string, unknown>;

  // Outreach actually sent in the last hour, per platform (by template_id).
  const s = (await pool
    .query(
      `SELECT
        COUNT(*) FILTER (WHERE template_id LIKE 'email_touch_%') bp,
        COUNT(*) FILTER (WHERE template_id LIKE 'sc_touch_%')    sc,
        COUNT(*) FILTER (WHERE template_id LIKE 'sp_touch_%')    sp,
        COUNT(*) FILTER (WHERE template_id LIKE 'radar_touch_%') rd
       FROM outreach_events WHERE sent_at > now() - ${H}`
    )
    .then((x) => x.rows[0] ?? {})
    .catch(() => ({}))) as Record<string, unknown>;

  const lines = [
    `📧 <b>Знайдено емейлів за годину</b>`,
    `Beatport — ${n(r.bp)}`,
    `SoundCloud — ${n(r.sc)}`,
    `Spotify — ${n(r.sp)}`,
  ];
  if (n(r.rd_total) > 0) lines.push(`Radar — ${n(r.rd)}`);

  lines.push(
    ``,
    `✉️ <b>Надіслано аутрічів за годину</b>`,
    `Beatport — ${n(s.bp)}`,
    `SoundCloud — ${n(s.sc)}`,
    `Spotify — ${n(s.sp)}`,
  );
  if (n(r.rd_total) > 0) lines.push(`Radar — ${n(s.rd)}`);

  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return NextResponse.json({ ok: true, found: r, sent: s, ts: new Date().toISOString() });
}
