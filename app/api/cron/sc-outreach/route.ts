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
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE_URL = "https://ninja-digger.vercel.app";
const PER_RUN = 4;          // spread the daily quota across hourly runs
const DOMAIN_DAILY_MAX = 280; // combined Beatport + SC ceiling (Brevo free ~300/day)

async function getSetting(key: string, fallback: string): Promise<string> {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key])
    .then((r) => r.rows[0]?.value ?? fallback).catch(() => fallback);
}
async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]).catch(() => {});
}

// Progressive warm-up: 20/day, growing ~25%/day (geometric), so we reach the
// ceiling in ~10 days instead of weeks. Ceiling is app_settings 'outreach_ramp_max'
// (default 130, under Brevo free ~300/day combined) — raise it after a Brevo
// upgrade and the system jumps higher with no redeploy.
function rampCap(daysSinceStart: number, max: number): number {
  return Math.min(max, Math.round(20 * Math.pow(1.25, daysSinceStart)));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((await getSetting("sc_outreach_paused", "1")) === "1") {
    return NextResponse.json({ ok: true, paused: true });
  }
  // Single-flight: Vercel cron is at-least-once, so a double-fired tick must not
  // double-send. If another instance holds the lease, bow out.
  if (!(await acquireLease("sc-outreach"))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }
  const hour = new Date().getUTCHours();
  if (hour < 6 || hour > 20) return NextResponse.json({ ok: true, skipped: "night" });

  // First live run stamps the ramp start date.
  let start = await getSetting("sc_outreach_start", "");
  if (!start) { start = new Date().toISOString(); await setSetting("sc_outreach_start", start); }
  const daysSinceStart = Math.floor((Date.now() - Date.parse(start)) / 86400000);
  const rampMax = parseInt(await getSetting("outreach_ramp_max", "130"), 10) || 130;
  const cap = rampCap(daysSinceStart, rampMax);

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
  const pct = parseInt(await getSetting("sc_discount", "25"), 10) || 25;
  const code = await getSetting("sc_promo_code", "SOUND20");

  // Pick the next lead to email: follow-ups (warmer) before fresh openers, and
  // only for leads still in 'Contacted' state (a reply/bounce/opt-out flips the
  // status and drops them out). Touch 2 waits 3 days after touch 1, touch 3
  // waits 4 more. Never re-contacts a blacklisted or already-replied lead.
  type Lead = { soundcloud_id: string; username: string; full_name: string | null; email: string; sc_touch: number };
  const nextTouch = (sql: string): Promise<Lead[]> =>
    pool.query<Lead>(sql, [budget]).then((r) => r.rows).catch(() => [] as Lead[]);
  // Exclude blacklist AND hostile-country domains (russia .ru/.su, Yandex; Belarus .by).
  const notBlacklisted = `LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist) AND email !~* '\\.(ru|su|by)$|yandex\\.'`;

  let leads = await nextTouch(
    `SELECT soundcloud_id, username, full_name, email, sc_touch FROM sc_artists
     WHERE sc_touch = 2 AND lead_status = 'Contacted' AND contacted_at < now() - interval '4 days'
       AND email IS NOT NULL AND ${notBlacklisted}
     ORDER BY (tier='A') DESC, followers_count DESC LIMIT $1`);
  if (leads.length < budget) {
    leads = leads.concat(await nextTouch(
      `SELECT soundcloud_id, username, full_name, email, sc_touch FROM sc_artists
       WHERE sc_touch = 1 AND lead_status = 'Contacted' AND contacted_at < now() - interval '3 days'
         AND email IS NOT NULL AND ${notBlacklisted}
       ORDER BY (tier='A') DESC, followers_count DESC LIMIT $1`));
  }
  if (leads.length < budget) {
    leads = leads.concat(await nextTouch(
      `SELECT soundcloud_id, username, full_name, email, sc_touch FROM sc_artists
       WHERE sc_touch = 0 AND (lead_status IS NULL OR lead_status = 'New')
         AND track_count >= 1 AND email IS NOT NULL AND ${notBlacklisted}
       ORDER BY (tier='A') DESC, followers_count DESC LIMIT $1`));
  }
  leads = leads.slice(0, budget);

  let sent = 0;
  const byTouch: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const lead of leads) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000)); // 20-45s apart
    const touch = (lead.sc_touch + 1) as 1 | 2 | 3;
    const name = lead.full_name || lead.username || "there";
    const unsubUrl = `${BASE_URL}/api/unsubscribe?u=${Buffer.from(lead.email).toString("base64url")}`;
    const email = buildScEmail(touch, { name, pct, code, unsubUrl });
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text, html: email.html });
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1,$2,'email',$3, now(),'sent')`, [`sc:${lead.soundcloud_id}`, `sc_touch_${touch}`, lead.email]
      ).catch(() => {});
      // touch 3 is the last — mark done so it isn't picked again.
      const status = touch === 3 ? "No Response" : "Contacted";
      await pool.query(`UPDATE sc_artists SET lead_status=$2, sc_touch=$3, contacted_at=now(), updated_at=now() WHERE soundcloud_id=$1`,
        [lead.soundcloud_id, status, touch]).catch(() => {});
      sent++; byTouch[touch]++;
    } catch (e) {
      if (isHardBounceError(e)) {
        await pool.query(`UPDATE sc_artists SET lead_status='Bounced', updated_at=now() WHERE soundcloud_id=$1`, [lead.soundcloud_id]).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true, daysSinceStart, cap, scSentToday: scSentToday + sent, sent, byTouch, ts: new Date().toISOString() });
}
