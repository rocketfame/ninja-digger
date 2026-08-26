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
  // Found this hour + the TOTAL email base per platform (the pool we've built).
  const r = (await pool
    .query(
      `SELECT
        (SELECT COUNT(*) FROM artist_contacts WHERE type='email' AND created_at > now() - ${H}) bp,
        (SELECT COUNT(*) FROM sc_artists    WHERE email_found_at > now() - ${H}) sc,
        (SELECT COUNT(*) FROM spotify_leads WHERE email_found_at > now() - ${H}) sp,
        (SELECT COUNT(*) FROM radar_leads   WHERE email_found_at > now() - ${H}) rd,
        (SELECT COUNT(DISTINCT LOWER(value)) FROM artist_contacts WHERE type='email') bp_base,
        (SELECT COUNT(*) FROM sc_artists    WHERE email IS NOT NULL) sc_base,
        (SELECT COUNT(*) FROM spotify_leads WHERE email IS NOT NULL) sp_base,
        (SELECT COUNT(*) FROM radar_leads   WHERE email IS NOT NULL) rd_base,
        (SELECT COUNT(*) FROM radar_leads) rd_total`
    )
    .then((x) => x.rows[0] ?? {})
    .catch(() => ({}))) as Record<string, unknown>;

  // Sent this hour (by template_id) + how many emails still remain to contact
  // (the outreach runway) per platform.
  const s = (await pool
    .query(
      `SELECT
        (SELECT COUNT(*) FILTER (WHERE template_id LIKE 'email_touch_%') FROM outreach_events WHERE sent_at > now() - ${H}) bp,
        (SELECT COUNT(*) FILTER (WHERE template_id LIKE 'sc_touch_%')    FROM outreach_events WHERE sent_at > now() - ${H}) sc,
        (SELECT COUNT(*) FILTER (WHERE template_id LIKE 'sp_touch_%')    FROM outreach_events WHERE sent_at > now() - ${H}) sp,
        (SELECT COUNT(*) FILTER (WHERE template_id LIKE 'radar_touch_%') FROM outreach_events WHERE sent_at > now() - ${H}) rd,
        (SELECT COUNT(DISTINCT ac.artist_beatport_id) FROM artist_contacts ac
           LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
           WHERE ac.type='email' AND (lp.status IS NULL OR lp.status='New')) bp_left,
        (SELECT COUNT(*) FROM sc_artists    WHERE email IS NOT NULL AND (lead_status IS NULL OR lead_status='New')) sc_left,
        (SELECT COUNT(*) FROM spotify_leads WHERE email IS NOT NULL AND (lead_status IS NULL OR lead_status='New')) sp_left,
        (SELECT COUNT(*) FROM radar_leads   WHERE email IS NOT NULL AND (status IS NULL OR status='new')) rd_left`
    )
    .then((x) => x.rows[0] ?? {})
    .catch(() => ({}))) as Record<string, unknown>;

  const lines = [
    `📧 <b>Знайдено емейлів за годину</b> <i>(база)</i>`,
    `Beatport — ${n(r.bp)} (${n(r.bp_base)})`,
    `SoundCloud — ${n(r.sc)} (${n(r.sc_base)})`,
    `Spotify — ${n(r.sp)} (${n(r.sp_base)})`,
  ];
  if (n(r.rd_total) > 0) lines.push(`Radar — ${n(r.rd)} (${n(r.rd_base)})`);

  lines.push(
    ``,
    `✉️ <b>Надіслано аутрічів за годину</b> <i>(залишилось)</i>`,
    `Beatport — ${n(s.bp)} (${n(s.bp_left)})`,
    `SoundCloud — ${n(s.sc)} (${n(s.sc_left)})`,
    `Spotify — ${n(s.sp)} (${n(s.sp_left)})`,
  );
  if (n(r.rd_total) > 0) lines.push(`Radar — ${n(s.rd)} (${n(s.rd_left)})`);

  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return NextResponse.json({ ok: true, found: r, sent: s, ts: new Date().toISOString() });
}
