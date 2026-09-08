/**
 * GET /api/cron/radar-outreach — outreach to Radar leads, per-source tailored
 * offer (YouTube leads get the YouTube-promo pitch). PAUSED by default
 * (app_settings radar_outreach_paused='1'). Uses the multi-account Brevo
 * rotation + the same warmup/night/hostile guards as the other barrels.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRotatingMailersChecked, senderPool, getSentBySenderToday } from "@/lib/mailer";
import { buildRadarEmail } from "@/lib/radarOutreachCopy";
import { isHardBounceError, validateEmailForOutreach } from "@/lib/emailHygiene";
import { quarantineEmail } from "@/lib/emailScrub";
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 15;        // 4 runs/hour: the hourly allowance is spread, not burnt at once

async function getSetting(key: string, fb: string) {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key]).then((r) => r.rows[0]?.value ?? fb).catch(() => fb);
}
function rampCap(days: number, max: number) { return Math.min(max, Math.round(20 * Math.pow(1.25, days))); }

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((await getSetting("radar_outreach_paused", "1")) === "1") return NextResponse.json({ ok: true, paused: true });
  if (!(await acquireLease("radar-outreach"))) return NextResponse.json({ ok: true, skipped: "locked" });
  const hour = new Date().getUTCHours();
  if (hour < 7) return NextResponse.json({ ok: true, skipped: "night" }); // 07:00-23:59 UTC: Europe morning → US West afternoon

  let start = await getSetting("radar_outreach_start", "");
  if (!start) { start = new Date().toISOString(); await pool.query(`INSERT INTO app_settings (key,value) VALUES ('radar_outreach_start',$1) ON CONFLICT (key) DO NOTHING`, [start]).catch(() => {}); }
  const cap = rampCap(Math.floor((Date.now() - Date.parse(start)) / 86400000), parseInt(await getSetting("outreach_ramp_max", "130"), 10) || 130);

  const q = (s: string) => pool.query<{ c: number }>(s).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  const sentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'radar_touch_%' AND sent_at >= CURRENT_DATE`);
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
  if (senders.budget <= 0) return NextResponse.json({ ok: true, cap, sentToday, sent: 0, note: "all sender accounts capped/blocked" });
  const budget = Math.min(cap - sentToday, senders.budget, PER_RUN);
  if (budget <= 0) return NextResponse.json({ ok: true, cap, sentToday, sent: 0, note: "quota reached" });

  const pct = parseInt(await getSetting("sc_discount", "25"), 10) || 25;

  // See sc-outreach: addresses handed to the marketing side are on hold.
  const notBad = `email IS NOT NULL AND LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist) AND email !~* '\\.(ru|su|by)$|yandex\\.'
     AND LOWER(email) NOT IN (SELECT email FROM lead_exports WHERE COALESCE(outcome,'') <> 'cold')`;
  type Lead = { id: number; source: string; name: string | null; email: string; touch: number };
  const pick = (sql: string) => pool.query<Lead>(sql, [budget]).then((r) => r.rows).catch(() => [] as Lead[]);

  let leads = await pick(
    `SELECT id, source, name, email, touch FROM radar_leads
     WHERE touch = 2 AND status='contacted' AND contacted_at < now() - interval '4 days' AND ${notBad}
     ORDER BY heat_score DESC LIMIT $1`);
  if (leads.length < budget) leads = leads.concat(await pick(
    `SELECT id, source, name, email, touch FROM radar_leads
     WHERE touch = 1 AND status='contacted' AND contacted_at < now() - interval '3 days' AND ${notBad}
     ORDER BY heat_score DESC LIMIT $1`));
  if (leads.length < budget) leads = leads.concat(await pick(
    `SELECT id, source, name, email, touch FROM radar_leads
     WHERE COALESCE(touch,0) = 0 AND COALESCE(status,'new') IN ('new','queued') AND ${notBad}
     ORDER BY heat_score DESC LIMIT $1`));
  leads = leads.slice(0, budget);

  let sent = 0, skippedJunk = 0;
  for (const lead of leads) {
    const m = senders.next();
    if (!m) break; // every account's hourly headroom is spent
    const { transporter, from, replyTo } = m.mailer;
    if (sent > 0) await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000)); // 4-7s: 30 sends fit in the 300s budget
    const touch = (lead.touch + 1) as 1 | 2 | 3;
    const email = buildRadarEmail(lead.source, touch, lead.name || "there", pct);
    // Pre-send gate: junk/role/placeholder/no-MX addresses never leave the
    // building — they go to the suppression list instead of burning reputation.
    const verdict = await validateEmailForOutreach(lead.email);
    if (!verdict.ok) { await quarantineEmail(lead.email, `pre-send (radar): ${verdict.reason}`); skippedJunk++; continue; }
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text });
      const recorded = await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
         VALUES ($1,$2,'email',$3, now(),'sent',$4)
         ON CONFLICT (artist_beatport_id, template_id) WHERE channel = 'email' AND artist_beatport_id IS NOT NULL
         DO UPDATE SET sent_at = now(), outcome = EXCLUDED.outcome, sender = EXCLUDED.sender, contact_value = EXCLUDED.contact_value, replied_at = NULL`, [`radar:${lead.id}`, `radar_touch_${touch}`, lead.email, m.senderId]
      ).then(() => true).catch((e) => { console.error("[radar-outreach] outreach_events insert failed — stopping run:", e instanceof Error ? e.message : e); return false; });
      await pool.query(`UPDATE radar_leads SET touch=$2, status=$3, contacted_at=now(), updated_at=now() WHERE id=$1`,
        [lead.id, touch, touch === 3 ? "done" : "contacted"]).catch(() => {});
      sent++;
      if (!recorded) break;
    } catch (e) {
      if (isHardBounceError(e)) await pool.query(`UPDATE radar_leads SET status='dead', email_status='bounced' WHERE id=$1`, [lead.id]).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, cap, sentToday, sent, skippedJunk, ts: new Date().toISOString() });
}
