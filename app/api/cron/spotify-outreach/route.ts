/**
 * GET /api/cron/spotify-outreach — cold outreach to Spotify-channel leads via
 * Brevo. Third independent "barrel" alongside Beatport + SoundCloud, each with
 * its own daily ramp; all three share the domain daily ceiling so we never
 * exceed the Brevo plan. PAUSED by default ('sp_outreach_paused'='1').
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRotatingMailerChecked, getSentBySenderToday } from "@/lib/mailer";
import { buildSpotifyEmail } from "@/lib/spotifyOutreachCopy";
import { isHardBounceError } from "@/lib/emailHygiene";
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 8;
const DOMAIN_DAILY_MAX = 280; // combined BP + SC + SP ceiling (Brevo free ~300/day)

async function getSetting(key: string, fallback: string): Promise<string> {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key])
    .then((r) => r.rows[0]?.value ?? fallback).catch(() => fallback);
}
async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]).catch(() => {});
}

// Progressive warm-up: 20/day, growing ~25%/day, ceiling = 'outreach_ramp_max'.
function rampCap(daysSinceStart: number, max: number): number {
  return Math.min(max, Math.round(20 * Math.pow(1.25, daysSinceStart)));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((await getSetting("sp_outreach_paused", "1")) === "1") {
    return NextResponse.json({ ok: true, paused: true });
  }
  // Single-flight guard against Vercel's at-least-once double-fire.
  if (!(await acquireLease("spotify-outreach"))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }
  const hour = new Date().getUTCHours();
  if (hour < 6 || hour > 20) return NextResponse.json({ ok: true, skipped: "night" });

  let start = await getSetting("sp_outreach_start", "");
  if (!start) { start = new Date().toISOString(); await setSetting("sp_outreach_start", start); }
  const daysSinceStart = Math.floor((Date.now() - Date.parse(start)) / 86400000);
  const rampMax = parseInt(await getSetting("outreach_ramp_max", "130"), 10) || 130;
  const cap = rampCap(daysSinceStart, rampMax);

  const q = (sql: string) => pool.query<{ c: number }>(sql).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  const spSentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sp_touch_%' AND sent_at >= CURRENT_DATE`);
  // Per-account sends today (legacy NULL sender → 'brevo1'). Domain budget is now
  // the SUM of remaining capacity across all Brevo accounts.
  const sentBySender = await getSentBySenderToday();
  const rm = await getRotatingMailerChecked(sentBySender);
  if (!rm) return NextResponse.json({ ok: true, cap, spSentToday, sent: 0, note: "all sender accounts capped/blocked" });
  // Budget against the PICKED account's headroom (one run = one account).
  const budget = Math.min(cap - spSentToday, rm.remaining, PER_RUN);
  if (budget <= 0) return NextResponse.json({ ok: true, cap, spSentToday, sent: 0, note: "quota reached" });
  const { transporter, from, replyTo } = rm.mailer;
  const senderId = rm.senderId;
  const pct = parseInt(await getSetting("sc_discount", "25"), 10) || 25;

  type Lead = { ig_username: string; full_name: string | null; email: string; sp_touch: number };
  const nextTouch = (sql: string): Promise<Lead[]> =>
    pool.query<Lead>(sql, [budget]).then((r) => r.rows).catch(() => [] as Lead[]);
  // Exclude blacklist AND hostile-country domains (russia .ru/.su, Yandex; Belarus .by).
  const notBlacklisted = `LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist) AND email !~* '\\.(ru|su|by)$|yandex\\.'`;

  // Follow-ups first (warmer), then fresh openers. Touch 2 waits 3 days after
  // touch 1, touch 3 waits 4 more. A reply/bounce/opt-out flips lead_status and
  // drops the lead out of the sequence automatically.
  let leads = await nextTouch(
    `SELECT ig_username, full_name, email, sp_touch FROM spotify_leads
     WHERE sp_touch = 2 AND lead_status = 'Contacted' AND contacted_at < now() - interval '4 days'
       AND email IS NOT NULL AND ${notBlacklisted}
     ORDER BY followers DESC NULLS LAST LIMIT $1`);
  if (leads.length < budget) {
    leads = leads.concat(await nextTouch(
      `SELECT ig_username, full_name, email, sp_touch FROM spotify_leads
       WHERE sp_touch = 1 AND lead_status = 'Contacted' AND contacted_at < now() - interval '3 days'
         AND email IS NOT NULL AND ${notBlacklisted}
       ORDER BY followers DESC NULLS LAST LIMIT $1`));
  }
  if (leads.length < budget) {
    leads = leads.concat(await nextTouch(
      `SELECT ig_username, full_name, email, sp_touch FROM spotify_leads
       WHERE sp_touch = 0 AND (lead_status IS NULL OR lead_status = 'New')
         AND email IS NOT NULL AND ${notBlacklisted}
       ORDER BY followers DESC NULLS LAST LIMIT $1`));
  }
  leads = leads.slice(0, budget);

  let sent = 0;
  const byTouch: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const lead of leads) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000));
    const touch = (lead.sp_touch + 1) as 1 | 2 | 3;
    const name = lead.full_name || lead.ig_username || "there";
    const email = buildSpotifyEmail(touch, { name, pct });
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text });
      const recorded = await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
         VALUES ($1,$2,'email',$3, now(),'sent',$4)`, [`sp:${lead.ig_username}`, `sp_touch_${touch}`, lead.email, senderId]
      ).then(() => true).catch((e) => { console.error("[spotify-outreach] outreach_events insert failed — stopping run:", e instanceof Error ? e.message : e); return false; });
      const status = touch === 3 ? "No Response" : "Contacted";
      await pool.query(`UPDATE spotify_leads SET lead_status=$2, sp_touch=$3, contacted_at=now(), updated_at=now() WHERE ig_username=$1`,
        [lead.ig_username, status, touch]).catch(() => {});
      sent++; byTouch[touch]++;
      if (!recorded) break;
    } catch (e) {
      if (isHardBounceError(e)) {
        await pool.query(`UPDATE spotify_leads SET lead_status='Bounced', email_status='bounced', updated_at=now() WHERE ig_username=$1`, [lead.ig_username]).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true, daysSinceStart, cap, spSentToday: spSentToday + sent, sent, byTouch, ts: new Date().toISOString() });
}
