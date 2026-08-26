/**
 * GET /api/cron/radar-outreach — outreach to Radar leads, per-source tailored
 * offer (YouTube leads get the YouTube-promo pitch). PAUSED by default
 * (app_settings radar_outreach_paused='1'). Uses the multi-account Brevo
 * rotation + the same warmup/night/hostile guards as the other barrels.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRotatingMailer, domainBudgetRemaining } from "@/lib/mailer";
import { buildRadarEmail } from "@/lib/radarOutreachCopy";
import { isHardBounceError } from "@/lib/emailHygiene";
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 4;

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
  if (hour < 6 || hour > 20) return NextResponse.json({ ok: true, skipped: "night" });

  let start = await getSetting("radar_outreach_start", "");
  if (!start) { start = new Date().toISOString(); await pool.query(`INSERT INTO app_settings (key,value) VALUES ('radar_outreach_start',$1) ON CONFLICT (key) DO NOTHING`, [start]).catch(() => {}); }
  const cap = rampCap(Math.floor((Date.now() - Date.parse(start)) / 86400000), parseInt(await getSetting("outreach_ramp_max", "130"), 10) || 130);

  const q = (s: string) => pool.query<{ c: number }>(s).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
  const sentToday = await q(`SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'radar_touch_%' AND sent_at >= CURRENT_DATE`);
  const sbs = await pool.query<{ sid: string; c: number }>(
    `SELECT COALESCE(sender,'brevo1') sid, COUNT(*)::int c FROM outreach_events WHERE channel='email' AND sent_at >= CURRENT_DATE GROUP BY 1`
  ).then((r) => r.rows).catch(() => [] as { sid: string; c: number }[]);
  const sentBySender: Record<string, number> = Object.fromEntries(sbs.map((r) => [r.sid, r.c]));
  const budget = Math.min(cap - sentToday, domainBudgetRemaining(sentBySender), PER_RUN);
  if (budget <= 0) return NextResponse.json({ ok: true, cap, sentToday, sent: 0, note: "quota reached" });

  const rm = getRotatingMailer(sentBySender);
  if (!rm) return NextResponse.json({ ok: false, error: "no mailer / all capped" }, { status: 500 });
  const { transporter, from, replyTo } = rm.mailer;
  const pct = parseInt(await getSetting("sc_discount", "25"), 10) || 25;

  const notBad = `email IS NOT NULL AND LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist) AND email !~* '\\.(ru|su|by)$|yandex\\.'`;
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

  let sent = 0;
  for (const lead of leads) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000));
    const touch = (lead.touch + 1) as 1 | 2 | 3;
    const email = buildRadarEmail(lead.source, touch, lead.name || "there", pct);
    try {
      await transporter.sendMail({ from, replyTo, to: lead.email, subject: email.subject, text: email.text });
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
         VALUES ($1,$2,'email',$3, now(),'sent',$4)`, [`radar:${lead.id}`, `radar_touch_${touch}`, lead.email, rm.senderId]
      ).catch(() => {});
      await pool.query(`UPDATE radar_leads SET touch=$2, status=$3, contacted_at=now(), updated_at=now() WHERE id=$1`,
        [lead.id, touch, touch === 3 ? "done" : "contacted"]).catch(() => {});
      sent++;
    } catch (e) {
      if (isHardBounceError(e)) await pool.query(`UPDATE radar_leads SET status='dead', email_status='bounced' WHERE id=$1`, [lead.id]).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, cap, sentToday, sent, ts: new Date().toISOString() });
}
