/**
 * GET /api/cron/pipeline
 * Hourly pipeline — Beatport outreach only (fast, no self-fetch).
 * RA outreach runs via separate /api/cron/ra endpoint.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";
import { validateEmailForOutreach, invalidateContactEmail, isHardBounceError } from "@/lib/emailHygiene";
// Cold touches go PLAIN TEXT with ZERO links on purpose: the sender reputation
// was burned (seed test landed in spam), so cold mail must look maximally
// personal. Branded HTML stays for warm replies only.
const PLAIN_SIGNATURE = `\n\n--\nMax\nPromoSound`;

import { JUNK_NAME_SQL, TIER_SQL } from "@/lib/leadQuality";
import { getRotatingMailer, domainBudgetRemaining } from "@/lib/mailer";
import { buildTouchEmail } from "@/lib/touchCopy";
import { acquireLease } from "@/lib/cronLock";

export const maxDuration = 300; // 5 min for natural-paced sends




type MailerCtx = { transporter: nodemailer.Transporter; from: string; replyTo?: string; senderId: string };
async function sendBeatportBatch(touchNum: number, fromStatus: string, toStatus: string, minDays: number, budget: number, m: MailerCtx | null) {
  if (!m) return 0;
  if (budget <= 0) return 0; // daily cap already exhausted
  const { transporter, from, replyTo, senderId } = m;
  const limit = Math.min(5, budget);

  // Touch 1 only for artists still in charts recently — a "congrats on your chart entry"
  // months after the fact reads as spam. Follow-ups (2/3) go regardless.
  const leads = await pool.query<{ id: string; name: string; email: string }>(`
    SELECT t.id, t.name, t.email FROM (
      SELECT DISTINCT ON (ac.artist_beatport_id)
        ac.artist_beatport_id as id, am.artist_name as name, ac.value as email,
        ls.segment, am.first_seen, ${TIER_SQL} AS tier
      FROM artist_contacts ac
      JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
      LEFT JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id
      LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
      WHERE ac.type = 'email' AND ac.confidence >= 0.65 AND (ac.status IS NULL OR ac.status = 'ok')
        AND (lp.status ${touchNum === 1 ? "IS NULL OR lp.status = 'New'" : `= '${fromStatus}'`})
        ${minDays > 0 ? `AND lp.updated_at < now() - interval '${minDays} days'` : ""}
        ${touchNum === 1 ? "AND am.last_seen >= current_date - 14" : ""}
        AND NOT ${JUNK_NAME_SQL}
        AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
      ORDER BY ac.artist_beatport_id, ac.confidence DESC
    ) t
    ORDER BY t.tier, CASE t.segment
      WHEN 'NEWCOMER' THEN 0 WHEN 'NEW_ENTRY' THEN 1 WHEN 'FAST_GROWING' THEN 2 ELSE 3 END,
      t.first_seen DESC NULLS LAST
    LIMIT ${limit}
  `);

  let sent = 0;
  for (const lead of leads.rows) {
    if (sent > 0) await new Promise(r => setTimeout(r, 20000 + Math.random() * 40000)); // 20-60s between emails
    try {
      const allEmails = await pool.query<{ value: string }>(
        `SELECT value FROM artist_contacts WHERE artist_beatport_id = $1 AND type = 'email' AND confidence >= 0.65
           AND (status IS NULL OR status = 'ok')
           AND LOWER(value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         ORDER BY confidence DESC`,
        [lead.id]
      );
      const email = buildTouchEmail(touchNum, lead.name);
      // Pre-send hygiene: validate every candidate; dead/junk addresses are
      // invalidated in DB immediately and never retried
      const valid: string[] = [];
      for (const { value } of allEmails.rows) {
        const check = await validateEmailForOutreach(value);
        if (check.ok) valid.push(value);
        else await invalidateContactEmail(value, check.reason);
      }
      if (valid.length === 0) continue; // no deliverable address — lead skipped, no status change
      const primary = valid[0];
      try {
        await transporter.sendMail({
          from,
          replyTo,
          to: primary,
          cc: valid.length > 1 ? valid.slice(1).join(", ") : undefined,
          subject: email.subject,
          text: email.text + PLAIN_SIGNATURE,
        });
      } catch (sendErr) {
        if (isHardBounceError(sendErr)) {
          await invalidateContactEmail(primary, "SMTP hard bounce");
          await pool.query(
            `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
             VALUES ($1, $2, 'email', $3, now(), 'bounced', $4)`,
            [lead.id, `email_touch_${touchNum}`, primary, senderId]
          ).catch(() => {});
        }
        throw sendErr;
      }
      // Record the send FIRST so the daily-cap counter is always accurate even
      // if the status write fails — otherwise a swallowed error uncaps sending.
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome, sender)
         VALUES ($1, $2, 'email', $3, now(), $4, $5)`,
        [lead.id, `email_touch_${touchNum}`, primary, toStatus, senderId]
      ).catch((e) => console.error("[cron/pipeline] outreach_events insert failed:", e instanceof Error ? e.message : e));
      // Advance the lead state machine (won't throw now that the constraint
      // allows these statuses; kept defensive so a bad status never re-sends).
      await pool.query(
        `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status = $2, updated_at = now()`,
        [lead.id, toStatus]
      ).catch((e) => console.error("[cron/pipeline] lead_profiles update failed:", e instanceof Error ? e.message : e));
      sent++;
    } catch (e) {
      console.error(`[cron/pipeline] send failed for ${lead.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const hour = new Date().getUTCHours();
  const rand = Math.random();
  const actions: string[] = [];

  // NOTE: self-healing chart ingest moved to its own cron (/api/cron/ingest-heal)
  // so heavy collection can never eat the send budget again. This handler now
  // does ONE thing: outreach sends.

  // Pause flag managed from the Telegram bot (/pause, /resume)
  const paused = await pool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'outreach_paused'`
  ).then((r) => r.rows[0]?.value === "1").catch(() => false);
  if (paused) {
    return NextResponse.json({ ok: true, hour, actions: ["paused"], ts: new Date().toISOString() });
  }
  // Single-flight: Vercel cron is at-least-once — block a double-fired tick from
  // double-sending Beatport touches.
  if (!(await acquireLease("pipeline-send"))) {
    return NextResponse.json({ ok: true, hour, actions: ["locked"], ts: new Date().toISOString() });
  }

  // Beatport outreach: every daytime hour (skip night). Previously gated behind
  // a random 35% skip which made BP dribble ~5/day and show spotty 0s in the
  // hourly report while SC/SP (no such dice) sent steadily. The daily ramp cap
  // still bounds volume; the per-run batch + domain ceiling keep it safe.
  if (hour >= 6 && hour <= 21) {
    let bpStart = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='bp_outreach_start'`)
      .then((r) => r.rows[0]?.value).catch(() => undefined);
    if (!bpStart) {
      bpStart = new Date().toISOString();
      await pool.query(`INSERT INTO app_settings (key,value) VALUES ('bp_outreach_start',$1) ON CONFLICT (key) DO NOTHING`, [bpStart]).catch(() => {});
    }
    const bpDays = Math.floor((Date.now() - Date.parse(bpStart)) / 86400000);
    const rampMax = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='outreach_ramp_max'`)
      .then((r) => parseInt(r.rows[0]?.value ?? "130", 10) || 130).catch(() => 130);
    const cap = Math.min(rampMax, Math.round(20 * Math.pow(1.25, bpDays)));
    const sentToday = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE`
    ).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
    if (sentToday >= cap) {
      actions.push(`daily cap reached (${sentToday}/${cap})`);
    } else {
      // Pick a rotating Brevo account for this run (per-account daily cap).
      const sbs = await pool.query<{ sid: string; c: number }>(
        `SELECT COALESCE(sender,'brevo1') sid, COUNT(*)::int c FROM outreach_events WHERE channel='email' AND sent_at >= CURRENT_DATE GROUP BY 1`
      ).then((r) => r.rows).catch(() => [] as { sid: string; c: number }[]);
      const sentBySender: Record<string, number> = Object.fromEntries(sbs.map((r) => [r.sid, r.c]));
      const rm = getRotatingMailer(sentBySender);
      const mctx: MailerCtx | null = rm ? { transporter: rm.mailer.transporter, from: rm.mailer.from, replyTo: rm.mailer.replyTo, senderId: rm.senderId } : null;
      // Shared daily budget across all three touches so the cap can't be
      // exceeded 3x by running three back-to-back batches in one hour.
      let budget = Math.min(cap - sentToday, domainBudgetRemaining(sentBySender));
      const t1 = await sendBeatportBatch(1, "New", "Attempt 1", 0, budget, mctx); budget -= t1;
      const t2 = await sendBeatportBatch(2, "Attempt 1", "Attempt 2", 2, budget, mctx); budget -= t2;
      const t3 = await sendBeatportBatch(3, "Attempt 2", "No Response", 3, budget, mctx);
      if (t1 + t2 + t3 > 0) actions.push(`bp: T1=${t1} T2=${t2} T3=${t3}`);
    }
  }

  // Cold marking: 5% chance
  if (rand < 0.05) {
    const cold = await pool.query(`UPDATE lead_profiles SET status = 'Cold', updated_at = now() WHERE status = 'No Response' AND updated_at < now() - interval '5 days'`);
    if ((cold.rowCount ?? 0) > 0) actions.push(`cold: ${cold.rowCount}`);
  }

  return NextResponse.json({ ok: true, hour, rand: Math.round(rand * 100) / 100, actions: actions.length > 0 ? actions : ["idle"], ts: new Date().toISOString() });
}
