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

  const lines = [
    `📧 <b>Знайдено емейлів за годину</b>`,
    `Beatport — ${n(r.bp)}`,
    `SoundCloud — ${n(r.sc)}`,
    `Spotify — ${n(r.sp)}`,
  ];
  if (n(r.rd_total) > 0) lines.push(`Radar — ${n(r.rd)}`);

  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return NextResponse.json({ ok: true, row: r, ts: new Date().toISOString() });
}
