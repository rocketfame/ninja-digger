/**
 * GET /api/cron/sc-outreach — cold outreach to SoundCloud leads via Brevo.
 * PAUSED by default (app_settings 'sc_outreach_paused'='1'); flip to '0' to go.
 * Warm-up ramp grows the daily volume slowly to protect domain reputation, and
 * sends are spread across hourly runs (a few at a time) rather than blasted.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRotatingMailersChecked, senderPool, getSentBySenderToday } from "@/lib/mailer";
import { rampCap } from "@/lib/sendPacing";
import { contactableSql } from "@/lib/leadPolicy";
import { buildScEmail } from "@/lib/scOutreachCopy";
import { isHardBounceError, validateEmailForOutreach } from "@/lib/emailHygiene";
import { quarantineEmail } from "@/lib/emailScrub";
import { acquireLease } from "@/lib/cronLock";
import { getSetting, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE_URL = "https://ninja-digger.vercel.app";
const PER_RUN = 15;        // 4 runs/hour: the hourly allowance is spread, not burnt at once


// Progressive warm-up: 20/day, growing ~25%/day (geometric), so we reach the
// ceiling in ~10 days instead of weeks. Ceiling is app_settings 'outreach_ramp_max'
// (default 130, under Brevo free ~300/day combined) — raise it after a Brevo
// upgrade and the system jumps higher with no redeploy. rampCap lives in
// lib/sendPacing, next to the hour weights — one place decides how much we send.

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
  if (hour < 7) return NextResponse.json({ ok: true, skipped: "night" }); // 07:00-23:59 UTC: Europe morning → US West afternoon

  // First live run stamps the ramp start date.
  let start = await getSetting("sc_outreach_start", "");
  // A failed stamp is not worth aborting a send run: the next run recomputes it.
  if (!start) { start = new Date().toISOString(); await setSetting("sc_outreach_start", start).catch(() => {}); }
  const daysSinceStart = Math.floor((Date.now() - Date.parse(start)) / 86400000);
  const rampMax = parseInt(await getSetting("outreach_ramp_max", "130"), 10) || 130;
  const cap = rampCap(daysSinceStart, rampMax);

  const q = (sql: string) => pool.query<{ c: number }>(sql).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  const scSentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sc_touch_%' AND sent_at >= CURRENT_DATE`);
  const sentBySender = await getSentBySenderToday();
  // One run draws from EVERY account with headroom, not just one: a single
  // account's hourly slice is about a third of what the domain can send, and
  // the other accounts would sit idle until their own barrel happened to pick
  // them.
  // Rhythm, not a burst: four staggered runs an hour, each opening at a random
  // point in its first minute. Three accounts interleaved inside a single
  // 3-minute burst still looks like one machine; spread over the hour with an
  // uneven start it looks like a person working through a list.
  await new Promise((r) => setTimeout(r, Math.random() * 40000));
  const senders = senderPool(await getRotatingMailersChecked(sentBySender));
  if (senders.budget <= 0) return NextResponse.json({ ok: true, cap, scSentToday, sent: 0, note: "all sender accounts capped/blocked" });
  const budget = Math.min(cap - scSentToday, senders.budget, PER_RUN);
  if (budget <= 0) return NextResponse.json({ ok: true, cap, scSentToday, sent: 0, note: "quota reached" });
  const pct = parseInt(await getSetting("sc_discount", "25"), 10) || 25;
  const code = await getSetting("sc_promo_code", "SOUND20");

  // Pick the next lead to email: follow-ups (warmer) before fresh openers, and
  // only for leads still in 'Contacted' state (a reply/bounce/opt-out flips the
  // status and drops them out). Touch 2 waits 3 days after touch 1, touch 3
  // waits 4 more. Never re-contacts a blacklisted or already-replied lead.
  type Lead = { soundcloud_id: string; username: string; full_name: string | null; email: string; sc_touch: number };
  const nextTouch = (sql: string): Promise<Lead[]> =>
    pool.query<Lead>(sql, [budget]).then((r) => r.rows).catch(() => [] as Lead[]);
  const notBlacklisted = contactableSql();

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

  let sent = 0, skippedJunk = 0;
  const byTouch: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const lead of leads) {
    const m = senders.next();
    if (!m) break; // every account's hourly headroom is spent
    const { transporter, from, replyTo } = m.mailer;
    const senderId = m.senderId;
    if (sent > 0) await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000)); // 4-7s: 30 sends fit in the 300s budget
    const touch = (lead.sc_touch + 1) as 1 | 2 | 3;
    const name = lead.full_name || lead.username || "there";
    const unsubUrl = `${BASE_URL}/api/unsubscribe?u=${Buffer.from(lead.email).toString("base64url")}`;
    const email = buildScEmail(touch, { name, pct, code, unsubUrl });
    // Pre-send gate: junk/role/placeholder/no-MX addresses never leave the
    // building — they go to the suppression list instead of burning reputation.
    const verdict = await validateEmailForOutreach(lead.email);
    if (!verdict.ok) { await quarantineEmail(lead.email, `pre-send (sc): ${verdict.reason}`); skippedJunk++; continue; }
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text });
      const recorded = await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
         VALUES ($1,$2,'email',$3, now(),'sent',$4)
         ON CONFLICT (artist_beatport_id, template_id) WHERE channel = 'email' AND artist_beatport_id IS NOT NULL
         DO UPDATE SET sent_at = now(), outcome = EXCLUDED.outcome, sender = EXCLUDED.sender, contact_value = EXCLUDED.contact_value, replied_at = NULL`, [`sc:${lead.soundcloud_id}`, `sc_touch_${touch}`, lead.email, senderId]
      ).then(() => true).catch((e) => { console.error("[sc-outreach] outreach_events insert failed — stopping run:", e instanceof Error ? e.message : e); return false; });
      // touch 3 is the last — mark done so it isn't picked again.
      const status = touch === 3 ? "No Response" : "Contacted";
      await pool.query(`UPDATE sc_artists SET lead_status=$2, sc_touch=$3, contacted_at=now(), updated_at=now() WHERE soundcloud_id=$1`,
        [lead.soundcloud_id, status, touch]).catch(() => {});
      sent++; byTouch[touch]++;
      if (!recorded) break;
    } catch (e) {
      if (isHardBounceError(e)) {
        await pool.query(`UPDATE sc_artists SET lead_status='Bounced', updated_at=now() WHERE soundcloud_id=$1`, [lead.soundcloud_id]).catch(() => {});
      }
    }
  }
  return NextResponse.json({ ok: true, daysSinceStart, cap, scSentToday: scSentToday + sent, sent, skippedJunk, byTouch, ts: new Date().toISOString() });
}
