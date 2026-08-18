/**
 * GET /api/cron/sc-outreach — cold outreach to SoundCloud leads via Brevo.
 * PAUSED by default (app_settings 'sc_outreach_paused'='1'); flip to '0' to go.
 * Warm-up ramp grows the daily volume slowly to protect domain reputation, and
 * sends are spread across hourly runs (a few at a time) rather than blasted.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOutreachMailer } from "@/lib/mailer";
import { buildScEmail } from "@/lib/scOutreachCopy";
import { isHardBounceError } from "@/lib/emailHygiene";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE_URL = "https://ninja-digger.vercel.app";
const PER_RUN = 4;          // spread the daily quota across hourly runs
const DOMAIN_DAILY_MAX = 150; // combined Beatport + SC ceiling for the domain

async function getSetting(key: string, fallback: string): Promise<string> {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key])
    .then((r) => r.rows[0]?.value ?? fallback).catch(() => fallback);
}
async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]).catch(() => {});
}

// Warm-up ladder: how many SC emails/day allowed given days since start.
function rampCap(daysSinceStart: number): number {
  if (daysSinceStart < 3) return 20;
  if (daysSinceStart < 7) return 40;
  if (daysSinceStart < 14) return 70;
  return 100;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((await getSetting("sc_outreach_paused", "1")) === "1") {
    return NextResponse.json({ ok: true, paused: true });
  }
  const hour = new Date().getUTCHours();
  if (hour < 6 || hour > 20) return NextResponse.json({ ok: true, skipped: "night" });

  // First live run stamps the ramp start date.
  let start = await getSetting("sc_outreach_start", "");
  if (!start) { start = new Date().toISOString(); await setSetting("sc_outreach_start", start); }
  const daysSinceStart = Math.floor((Date.now() - Date.parse(start)) / 86400000);
  const cap = rampCap(daysSinceStart);

  const q = (sql: string) => pool.query<{ c: number }>(sql).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  const scSentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sc_touch_%' AND sent_at >= CURRENT_DATE`);
  const domainSentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND sent_at >= CURRENT_DATE`);
  const budget = Math.min(cap - scSentToday, DOMAIN_DAILY_MAX - domainSentToday, PER_RUN);
  if (budget <= 0) {
    return NextResponse.json({ ok: true, cap, scSentToday, domainSentToday, sent: 0, note: "quota reached" });
  }

  const mailer = getOutreachMailer();
  if (!mailer) return NextResponse.json({ ok: false, error: "no mailer" }, { status: 500 });
  const { transporter, from, replyTo } = mailer;
  const pct = parseInt(await getSetting("sc_discount", "20"), 10) || 20;
  const code = await getSetting("sc_promo_code", "SOUND20");

  // Best leads first (tier A gems), one email per address, skip blacklisted.
  const leads = (await pool.query<{ soundcloud_id: string; username: string; full_name: string | null; email: string }>(
    `SELECT soundcloud_id, username, full_name, email FROM sc_artists
     WHERE email IS NOT NULL AND contacted_at IS NULL
       AND (lead_status IS NULL OR lead_status = 'New')
       AND track_count >= 1
       AND LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist)
     ORDER BY (tier='A') DESC, followers_count DESC LIMIT $1`, [budget]
  )).rows;

  let sent = 0;
  for (const lead of leads) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000)); // 20-45s apart
    const name = lead.full_name || lead.username || "there";
    const unsubUrl = `${BASE_URL}/api/unsubscribe?u=${Buffer.from(lead.email).toString("base64url")}`;
    const email = buildScEmail({ name, pct, code, unsubUrl });
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text });
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1,'sc_touch_1','email',$2, now(),'sent')`, [`sc:${lead.soundcloud_id}`, lead.email]
      ).catch(() => {});
      await pool.query(`UPDATE sc_artists SET lead_status='Contacted', contacted_at=now(), updated_at=now() WHERE soundcloud_id=$1`, [lead.soundcloud_id]).catch(() => {});
      sent++;
    } catch (e) {
      if (isHardBounceError(e)) {
        await pool.query(`UPDATE sc_artists SET lead_status='Bounced', updated_at=now() WHERE soundcloud_id=$1`, [lead.soundcloud_id]).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true, daysSinceStart, cap, scSentToday: scSentToday + sent, sent, ts: new Date().toISOString() });
}
