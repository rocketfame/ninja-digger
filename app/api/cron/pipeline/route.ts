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
const GREETINGS = ["Hi", "Hey", "Hello", "Hi there,"];

/** Break the template fingerprint a bit: vary the greeting per send. */
function varyBody(body: string): string {
  const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  return body.replace(/^(Hi|Hey|Hello)\b/, g.replace(/,$/, ""));
}
import { JUNK_NAME_SQL, TIER_SQL } from "@/lib/leadQuality";
import { getOutreachMailer } from "@/lib/mailer";
import { runBptoptrackerDailyUpdate } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 300; // 5 min for natural-paced sends


const TOUCHES = [
  { // Touch 1
    subjects: ["Congrats on your recent Beatport chart entry | Promosound","Noticed your Beatport chart movement","Your track is climbing, quick thought","Beatport charts + a brief idea for you","Saw your chart entry, wanted to reach out"],
    bodies: [(n:string)=>`Hi ${n},\n\nSaw your recent appearance in the Beatport charts. Great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nNoticed your track charting on Beatport, well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nYour Beatport chart entry caught my attention, impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,(n:string)=>`Hey ${n},\n\nCongrats on the Beatport chart placement, that is a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more.\n\nMax`,(n:string)=>`Hi ${n},\n\nJust spotted your track on the Beatport charts, nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`],
  },
  { // Touch 2
    subjects: ["Re: chart momentum","Quick follow-up on my previous note","Circling back on your Beatport momentum","Following up, still relevant?","Re: your chart entry, brief follow-up"],
    bodies: [(n:string)=>`Hi ${n},\n\nJust wanted to briefly follow up in case my previous message got buried.\n\nWhen a track starts moving in the charts, there's usually a short window where additional exposure can significantly amplify results.\n\nIf you're open to it, I can outline how we typically approach this stage for electronic releases.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nFollowing up quickly, I reached out a few days ago about your chart entry.\n\nThe timing window for amplifying chart momentum is usually pretty short, so wanted to make sure this landed on your radar.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,(n:string)=>`Hey ${n},\n\nJust a quick nudge in case my last email slipped through.\n\nYour track is still in a great position to benefit from targeted promotion. We have seen similar artists extend their chart run significantly at this stage.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nWanted to circle back briefly. I wrote to you recently about your Beatport chart activity.\n\nWe work with artists at exactly this stage, when there is real chart traction to build on. No pressure, just wanted to make sure you saw the offer.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nShort follow-up, I mentioned PromoSound a few days back regarding your chart entry.\n\nIf you're still riding the momentum, we could potentially help extend it. If the timing isn't right, totally understand.\n\nBest,\nMax`],
  },
  { // Touch 3
    subjects: ["Should I close the loop?","Last check-in, no worries either way","One final note before I step back","Closing out, best of luck with the release","Final follow-up from PromoSound"],
    bodies: [(n:string)=>`Hi ${n},\n\nI'll keep this short. Just wanted to check once more before I step back.\n\nIf building on your recent chart momentum is something you'd like to explore, I'd be glad to connect.\n\nIf now isn't the right time, no worries at all. Wishing you continued success with the release.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nThis will be my last note, I don't want to crowd your inbox.\n\nIf you ever want to explore promotion support for a future release, feel free to reach out anytime.\n\nWishing you all the best with your music.\n\nMax`,(n:string)=>`Hey ${n},\n\nJust a final check-in. If this isn't the right time, I completely get it.\n\nThe door's always open if you'd like to work together down the line. Keep up the great work.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit right now.\n\nIf a future release hits the charts and you'd like a promotion partner, I'm an email away.\n\nAll the best,\nMax`,(n:string)=>`Hi ${n},\n\nLast note from me, I will step back after this.\n\nIf supporting your chart momentum is something you'd like to revisit later, feel free to get in touch whenever.\n\nGood luck with everything.\n\nBest,\nMax`],
  },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function sendBeatportBatch(touchNum: number, fromStatus: string, toStatus: string, minDays: number) {
  const mailer = getOutreachMailer();
  if (!mailer) return 0;
  const { transporter, from, replyTo } = mailer;

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
    LIMIT 5
  `);

  const touch = TOUCHES[touchNum - 1];
  let sent = 0;
  for (const lead of leads.rows) {
    if (sent > 0) await new Promise(r => setTimeout(r, 20000 + Math.random() * 40000)); // 20-60s between emails
    const v = hashId(lead.id) % touch.subjects.length;
    try {
      const allEmails = await pool.query<{ value: string }>(
        `SELECT value FROM artist_contacts WHERE artist_beatport_id = $1 AND type = 'email' AND confidence >= 0.65
           AND (status IS NULL OR status = 'ok')
           AND LOWER(value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         ORDER BY confidence DESC`,
        [lead.id]
      );
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
        const bodyText = varyBody(touch.bodies[v](lead.name));
        await transporter.sendMail({
          from,
          replyTo,
          to: primary,
          cc: valid.length > 1 ? valid.slice(1).join(", ") : undefined,
          subject: touch.subjects[v],
          text: bodyText + PLAIN_SIGNATURE,
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
      await pool.query(
        `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status = $2, updated_at = now()`,
        [lead.id, toStatus]
      );
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1, $2, 'email', $3, now(), $4)`,
        [lead.id, `email_touch_${touchNum}`, primary, toStatus]
      ).catch((e) => console.error("[cron/pipeline] outreach_events insert failed:", e instanceof Error ? e.message : e));
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
      const t1 = await sendBeatportBatch(1, "New", "Attempt 1", 0);
      const t2 = await sendBeatportBatch(2, "Attempt 1", "Attempt 2", 2);
      const t3 = await sendBeatportBatch(3, "Attempt 2", "No Response", 3);
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
