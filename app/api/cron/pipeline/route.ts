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
import { getOutreachMailer } from "@/lib/mailer";
import { buildTouchEmail } from "@/lib/touchCopy";
import { runBptoptrackerDailyUpdate } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 300; // 5 min for natural-paced sends




async function sendBeatportBatch(touchNum: number, fromStatus: string, toStatus: string, minDays: number, budget = 5) {
  const mailer = getOutreachMailer();
  if (!mailer) return 0;
  if (budget <= 0) return 0; // daily cap already exhausted
  const { transporter, from, replyTo } = mailer;
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
            `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
             VALUES ($1, $2, 'email', $3, now(), 'bounced')`,
            [lead.id, `email_touch_${touchNum}`, primary]
          ).catch(() => {});
        }
        throw sendErr;
      }
      // Record the send FIRST so the daily-cap counter is always accurate even
      // if the status write fails — otherwise a swallowed error uncaps sending.
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1, $2, 'email', $3, now(), $4)`,
        [lead.id, `email_touch_${touchNum}`, primary, toStatus]
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

  // Self-healing ingest: if the morning daily cron missed today's charts,
  // collect them now (once — guarded by a soft lock) and skip sends this hour.
  if (hour >= 7) {
    const todayRows = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM bptoptracker_daily WHERE snapshot_date = CURRENT_DATE`
    ).then((r) => r.rows[0]?.c ?? 0).catch(() => -1);
    if (todayRows === 0) {
      const lock = await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('ingest_heal_lock', to_char(now(), 'YYYY-MM-DD'), now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         WHERE app_settings.value != to_char(now(), 'YYYY-MM-DD') OR app_settings.updated_at < now() - interval '30 minutes'`
      ).then((r) => (r.rowCount ?? 0) > 0).catch(() => false);
      if (lock) {
        console.log("[cron/pipeline] today's charts missing — self-healing ingest");
        const bpt = await runBptoptrackerDailyUpdate();
        if (bpt.inserted === 0) {
          // BPTT refused everything (login throttle / downtime) — retry next hour quietly
          await sendTelegramMessage(
            `🛠 Ранковий збір чартів ще не вдався (BPTT недоступний, ${bpt.errors.length} відмов) — повторю за годину.`
          );
          return NextResponse.json({ ok: true, hour, actions: ["self-heal failed, will retry"], ts: new Date().toISOString() });
        }
        await syncBptoptrackerToChartEntries();
        const metrics = await refreshArtistMetrics();
        const scores = await refreshLeadScoresV2();
        await sendTelegramMessage(
          `🛠 <b>Самолікування:</b> ранковий збір чартів не відпрацював — зібрав зараз.\n` +
          `+${bpt.inserted} рядків · метрики: ${metrics} · скоринг: ${scores}` +
          (bpt.errors.length ? `\n⚠️ Помилок: ${bpt.errors.length}` : "")
        );
        return NextResponse.json({ ok: true, hour, actions: [`self-heal: +${bpt.inserted}`], ts: new Date().toISOString() });
      }
    }
  }

  // Pause flag managed from the Telegram bot (/pause, /resume)
  const paused = await pool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'outreach_paused'`
  ).then((r) => r.rows[0]?.value === "1").catch(() => false);
  if (paused) {
    return NextResponse.json({ ok: true, hour, actions: ["paused"], ts: new Date().toISOString() });
  }

  // Beatport outreach: 60% chance, skip night. Daily cap (app_settings) guards
  // the post-burn reputation ramp-up.
  if (hour >= 6 && hour <= 21 && rand < 0.65) {
    const cap = await pool.query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'daily_send_cap'`
    ).then((r) => parseInt(r.rows[0]?.value ?? "999", 10) || 999).catch(() => 999);
    const sentToday = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE`
    ).then((r) => r.rows[0]?.c ?? 0).catch(() => 0);
    if (sentToday >= cap) {
      actions.push(`daily cap reached (${sentToday}/${cap})`);
    } else {
      // Shared daily budget across all three touches so the cap can't be
      // exceeded 3x by running three back-to-back batches in one hour.
      let budget = cap - sentToday;
      const t1 = await sendBeatportBatch(1, "New", "Attempt 1", 0, budget); budget -= t1;
      const t2 = await sendBeatportBatch(2, "Attempt 1", "Attempt 2", 2, budget); budget -= t2;
      const t3 = await sendBeatportBatch(3, "Attempt 2", "No Response", 3, budget);
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
