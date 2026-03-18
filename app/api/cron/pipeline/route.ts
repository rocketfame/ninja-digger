/**
 * GET /api/cron/pipeline
 * Запускається щогодини. Виконує різні дії залежно від часу доби.
 * Рандомізація: кожна дія має ~40% шанс спрацювати, розподіляючи навантаження.
 *
 * Дії:
 * 1. Outreach (Touch 1/2/3) — ~6-8 разів на день, нерівномірно
 * 2. Enrichment (5 артистів) — ~8-10 разів на день
 * 3. Bounce cleanup — раз на день
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";

export const maxDuration = 60;

const SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nSPOTIFY PROMO: https://promosoundgroup.net/collections/spotify-promotion\nBEATPORT PROMO: https://promosoundgroup.net/collections/beatport-top-100-promotion\nSOUNDCLOUD PROMO: https://promosoundgroup.net/collections/soundcloud-promotion\nPROMOSOUND: https://promosoundgroup.net/`;

const TOUCHES = [
  { subjects: ["Congrats on your recent Beatport chart entry | Promosound","Noticed your Beatport chart movement","Your track is climbing — quick thought","Beatport charts + a brief idea for you","Saw your chart entry — wanted to reach out"],
    bodies: [(n:string)=>`Hi ${n},\n\nSaw your recent appearance in the Beatport charts — great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nNoticed your track charting on Beatport — well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nYour Beatport chart entry caught my attention — impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum — the window right after a chart entry.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,(n:string)=>`Hey ${n},\n\nCongrats on the Beatport chart placement — that's a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more about how we approach it.\n\nMax`,(n:string)=>`Hi ${n},\n\nJust spotted your track on the Beatport charts — nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`]},
  { subjects: ["Re: chart momentum","Quick follow-up on my previous note","Circling back — your Beatport momentum","Following up — still relevant?","Re: your chart entry — brief follow-up"],
    bodies: [(n:string)=>`Hi ${n},\n\nJust wanted to briefly follow up in case my previous message got buried.\n\nWhen a track starts moving in the charts, there's usually a short window where additional exposure can significantly amplify results.\n\nIf you're open to it, I can outline how we typically approach this stage for electronic releases.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nFollowing up quickly — I reached out a few days ago about your chart entry.\n\nThe timing window for amplifying chart momentum is usually pretty short, so wanted to make sure this landed on your radar.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,(n:string)=>`Hey ${n},\n\nJust a quick nudge in case my last email slipped through.\n\nYour track is still in a great position to benefit from targeted promotion.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nWanted to circle back briefly. I wrote to you recently about your Beatport chart activity.\n\nWe work with artists at exactly this stage — when there's real chart traction to build on. No pressure, just wanted to make sure you saw the offer.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nShort follow-up — I mentioned PromoSound a few days back regarding your chart entry.\n\nIf you're still riding the momentum, we could potentially help extend it. If the timing isn't right, totally understand.\n\nBest,\nMax`]},
  { subjects: ["Should I close the loop?","Last check-in — no worries either way","One final note before I step back","Closing out — best of luck","Final follow-up from PromoSound"],
    bodies: [(n:string)=>`Hi ${n},\n\nI'll keep this short — just wanted to check once more before I step back.\n\nIf building on your recent chart momentum is something you'd like to explore, I'd be glad to connect.\n\nIf now isn't the right time, no worries at all — wishing you continued success.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nThis will be my last note — don't want to crowd your inbox.\n\nIf you ever want to explore promotion support, feel free to reach out anytime.\n\nWishing you all the best.\n\nMax`,(n:string)=>`Hey ${n},\n\nJust a final check-in. If this isn't the right time, I completely get it.\n\nThe door's always open if you'd like to work together down the line.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit right now.\n\nIf a future release hits the charts and you'd like a promotion partner, I'm an email away.\n\nAll the best,\nMax`,(n:string)=>`Hi ${n},\n\nLast note from me — I'll step back after this.\n\nFeel free to get in touch whenever.\n\nGood luck with everything.\n\nBest,\nMax`]}
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function sendBatch(touchNum: number, fromStatus: string, toStatus: string, minAgeDays: number) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { touch: touchNum, sent: 0 };

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  const touch = TOUCHES[touchNum - 1];

  // Send max 5 per batch to spread across hours
  const leads = await pool.query<{ id: string; name: string; email: string }>(`
    SELECT DISTINCT ON (ac.artist_beatport_id)
      ac.artist_beatport_id as id, am.artist_name as name, ac.value as email
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email' AND ac.confidence >= 0.65 AND ac.status != 'bounced'
      AND (lp.status ${touchNum === 1 ? "IS NULL OR lp.status = 'New'" : `= '${fromStatus}'`})
      ${minAgeDays > 0 ? `AND lp.updated_at < now() - interval '${minAgeDays} days'` : ""}
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
    LIMIT 5
  `);

  let sent = 0;
  for (const lead of leads.rows) {
    if (sent > 0) await new Promise(r => setTimeout(r, 3000 + Math.random() * 15000));
    const v = hashId(lead.id) % touch.subjects.length;
    // Get ALL valid emails for CC
    const allEmails = await pool.query<{ value: string }>(
      `SELECT value FROM artist_contacts WHERE artist_beatport_id = $1 AND type = 'email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced') ORDER BY confidence DESC`,
      [lead.id]
    );
    const primaryEmail = allEmails.rows[0]?.value || lead.email;
    const ccEmails = allEmails.rows.slice(1).map((r: { value: string }) => r.value);
    try {
      await transporter.sendMail({
        from: `"Max from PromoSound" <${user}>`,
        to: primaryEmail,
        cc: ccEmails.length > 0 ? ccEmails.join(", ") : undefined,
        subject: touch.subjects[v],
        text: touch.bodies[v](lead.name) + SIGNATURE,
      });
      await pool.query(
        `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status = $2, updated_at = now()`,
        [lead.id, toStatus]
      );
      await pool.query(
        `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1, $2, 'email', $3, now(), $4)`,
        [lead.id, `email_touch_${touchNum}`, lead.email, toStatus]
      ).catch(() => {}); // ignore if column mismatch
      sent++;
    } catch { /* skip */ }
  }
  return { touch: touchNum, sent };
}

async function enrichBatch() {
  // Enrich 3 random artists without emails
  try {
    const artists = await pool.query(`
      WITH gc AS (
        SELECT DISTINCT artist_beatport_id, artist_name
        FROM bptoptracker_daily
        WHERE artist_beatport_id IS NOT NULL AND snapshot_date >= CURRENT_DATE - interval '7 days'
      )
      SELECT gc.artist_beatport_id
      FROM gc
      LEFT JOIN artist_contacts ac ON gc.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
      LEFT JOIN enrichment_runs er ON er.scope_id = gc.artist_beatport_id AND er.started_at > CURRENT_DATE - interval '1 day'
      WHERE ac.id IS NULL AND er.id IS NULL
      ORDER BY random()
      LIMIT 3
    `);
    let enriched = 0;
    for (const a of artists.rows) {
      try {
        const { runEnrichmentForArtist } = await import("@/lib/enrichV1");
        await runEnrichmentForArtist(a.artist_beatport_id);
        enriched++;
      } catch { /* skip */ }
    }
    return enriched;
  } catch { return 0; }
}

export async function GET() {
  const hour = new Date().getUTCHours();
  const rand = Math.random();
  const actions: string[] = [];

  // Outreach: ~40% chance each hour (= ~10 times/day), skip night hours
  if (hour >= 6 && hour <= 21 && rand < 0.45) {
    const t1 = await sendBatch(1, "New", "Attempt 1", 0);
    const t2 = await sendBatch(2, "Attempt 1", "Attempt 2", 2);
    const t3 = await sendBatch(3, "Attempt 2", "No Response", 3);
    if (t1.sent + t2.sent + t3.sent > 0) {
      actions.push(`outreach: T1=${t1.sent} T2=${t2.sent} T3=${t3.sent}`);
    }
  }

  // Enrichment: ~50% chance each hour (= ~12 times/day)
  if (rand < 0.55) {
    const enriched = await enrichBatch();
    if (enriched > 0) actions.push(`enriched: ${enriched}`);
  }

  // RA Promoter outreach: ~30% chance, different hours than Beatport
  if (hour >= 8 && hour <= 20 && rand > 0.3 && rand < 0.6) {
    try {
      const raRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://ninja-digger.vercel.app'}/api/internal/ra/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touchNum: 1, batchSize: 3 }),
      });
      const raData = await raRes.json() as { sent?: number };
      if ((raData.sent ?? 0) > 0) actions.push(`ra_outreach: ${raData.sent}`);
    } catch { /* skip RA errors */ }
  }

  // RA scrape: once a day (~4% per hour = ~1x/day)
  if (rand < 0.04) {
    try {
      const scrapeRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://ninja-digger.vercel.app'}/api/internal/ra/scrape`, { method: 'POST' });
      const scrapeData = await scrapeRes.json() as { eventsAdded?: number; promotersAdded?: number };
      if ((scrapeData.eventsAdded ?? 0) > 0) actions.push(`ra_scrape: ${scrapeData.eventsAdded} events`);
    } catch { /* skip */ }
  }

  // RA enrichment: ~25% chance
  if (rand > 0.5 && rand < 0.75) {
    try {
      const enrichRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://ninja-digger.vercel.app'}/api/internal/ra/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 5 }),
      });
      const enrichData = await enrichRes.json() as { totalEmails?: number };
      if ((enrichData.totalEmails ?? 0) > 0) actions.push(`ra_enrich: ${enrichData.totalEmails} emails`);
    } catch { /* skip */ }
  }

  // Cold marking: once a day (low probability per hour)
  if (rand < 0.05) {
    // Beatport cold
    const cold = await pool.query(`
      UPDATE lead_profiles SET status = 'Cold', updated_at = now()
      WHERE status = 'No Response' AND updated_at < now() - interval '5 days'
    `);
    // RA cold
    const raCold = await pool.query(`
      UPDATE ra_promoter_profiles SET status = 'Cold', updated_at = now()
      WHERE status = 'No Response' AND updated_at < now() - interval '5 days'
    `).catch(() => ({ rowCount: 0 }));
    const totalCold = (cold.rowCount ?? 0) + (raCold.rowCount ?? 0);
    if (totalCold > 0) actions.push(`cold: ${totalCold}`);
  }

  return NextResponse.json({
    ok: true,
    hour,
    rand: Math.round(rand * 100) / 100,
    actions: actions.length > 0 ? actions : ["idle"],
    ts: new Date().toISOString(),
  });
}
