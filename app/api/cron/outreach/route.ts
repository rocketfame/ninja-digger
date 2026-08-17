/**
 * GET /api/cron/outreach
 * Vercel Cron Job — автоматична відправка Touch 1/2/3.
 * Запускається щодня:
 *   Touch 1: нові ліди (status=New)
 *   Touch 2: через 3 дні після Touch 1 (status=Attempt 1, updated > 3 days ago)
 *   Touch 3: через 5 днів після Touch 2 (status=Attempt 2, updated > 5 days ago)
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";

export const maxDuration = 60;

// Reuse templates from send endpoint
const TOUCHES = [
  { // Touch 1
    subjects: ["Congrats on your recent Beatport chart entry | Promosound", "Noticed your Beatport chart movement", "Your track is climbing, quick thought", "Beatport charts + a brief idea for you", "Saw your chart entry, wanted to reach out"],
    bodies: [
      (n: string) => `Hi ${n},\n\nSaw your recent appearance in the Beatport charts. Great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,
      (n: string) => `Hi ${n},\n\nNoticed your track charting on Beatport, well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,
      (n: string) => `Hi ${n},\n\nYour Beatport chart entry caught my attention, impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum: the window right after a chart entry.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,
      (n: string) => `Hey ${n},\n\nCongrats on the Beatport chart placement, that is a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more about how we approach it.\n\nMax`,
      (n: string) => `Hi ${n},\n\nJust spotted your track on the Beatport charts, nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`,
    ],
  },
  { // Touch 2
    subjects: ["Re: chart momentum", "Quick follow-up on my previous note", "Circling back on your Beatport momentum", "Following up, still relevant?", "Re: your chart entry, brief follow-up"],
    bodies: [
      (n: string) => `Hi ${n},\n\nJust wanted to briefly follow up in case my previous message got buried.\n\nWhen a track starts moving in the charts, there's usually a short window where additional exposure can significantly amplify results.\n\nIf you're open to it, I can outline how we typically approach this stage for electronic releases.\n\nBest,\nMax`,
      (n: string) => `Hi ${n},\n\nFollowing up quickly, I reached out a few days ago about your chart entry.\n\nThe timing window for amplifying chart momentum is usually pretty short, so wanted to make sure this landed on your radar.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,
      (n: string) => `Hey ${n},\n\nJust a quick nudge in case my last email slipped through.\n\nYour track is still in a great position to benefit from targeted promotion. We have seen similar artists extend their chart run significantly at this stage.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,
      (n: string) => `Hi ${n},\n\nWanted to circle back briefly. I wrote to you recently about your Beatport chart activity.\n\nWe work with artists at exactly this stage, when there is real chart traction to build on. No pressure, just wanted to make sure you saw the offer.\n\nCheers,\nMax`,
      (n: string) => `Hi ${n},\n\nShort follow-up, I mentioned PromoSound a few days back regarding your chart entry.\n\nIf you're still riding the momentum, we could potentially help extend it. If the timing isn't right, totally understand.\n\nBest,\nMax`,
    ],
  },
  { // Touch 3
    subjects: ["Should I close the loop?", "Last check-in, no worries either way", "One final note before I step back", "Closing out, best of luck with the release", "Final follow-up from PromoSound"],
    bodies: [
      (n: string) => `Hi ${n},\n\nI'll keep this short. Just wanted to check once more before I step back.\n\nIf building on your recent chart momentum is something you'd like to explore, I'd be glad to connect.\n\nIf now isn't the right time, no worries at all. Wishing you continued success with the release.\n\nBest,\nMax`,
      (n: string) => `Hi ${n},\n\nThis will be my last note, I don't want to crowd your inbox.\n\nIf you ever want to explore promotion support for a future release, feel free to reach out anytime.\n\nWishing you all the best with your music.\n\nMax`,
      (n: string) => `Hey ${n},\n\nJust a final check-in. If this isn't the right time, I completely get it.\n\nThe door's always open if you'd like to work together down the line. Keep up the great work.\n\nCheers,\nMax`,
      (n: string) => `Hi ${n},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit right now.\n\nIf a future release hits the charts and you'd like a promotion partner, I'm an email away.\n\nAll the best,\nMax`,
      (n: string) => `Hi ${n},\n\nLast note from me, I will step back after this.\n\nIf supporting your chart momentum is something you'd like to revisit later, feel free to get in touch whenever.\n\nGood luck with everything.\n\nBest,\nMax`,
    ],
  },
];

const SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nSPOTIFY PROMO: https://promosoundgroup.net/collections/spotify-promotion\nBEATPORT PROMO: https://promosoundgroup.net/collections/beatport-top-100-promotion\nSOUNDCLOUD PROMO: https://promosoundgroup.net/collections/soundcloud-promotion\nPROMOSOUND: https://promosoundgroup.net/`;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function sendBatch(touchNum: number, fromStatus: string, toStatus: string, minAgeDays: number) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { touch: touchNum, sent: 0, error: "GMAIL not configured" };

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  const touch = TOUCHES[touchNum - 1];

  const leads = await pool.query<{ id: string; name: string; email: string }>(`
    SELECT DISTINCT ON (ac.artist_beatport_id)
      ac.artist_beatport_id as id, am.artist_name as name, ac.value as email
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email' AND ac.confidence >= 0.65
      AND (ac.status IS NULL OR ac.status = 'ok')
      AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
      AND (lp.status ${touchNum === 1 ? "IS NULL OR lp.status = 'New'" : `= '${fromStatus}'`})
      ${minAgeDays > 0 ? `AND lp.updated_at < now() - interval '${minAgeDays} days'` : ""}
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
    LIMIT 30
  `);

  let sent = 0;
  for (const lead of leads.rows) {
    // Random delay 5-30s between emails to avoid spam patterns
    if (sent > 0) await new Promise(r => setTimeout(r, 5000 + Math.random() * 25000));
    const v = hashId(lead.id) % touch.subjects.length;
    try {
      await transporter.sendMail({
        from: `"Max from PromoSound" <${user}>`,
        to: lead.email,
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
      );
      sent++;
    } catch { /* skip failed */ }
  }
  return { touch: touchNum, sent, total: leads.rows.length };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await Promise.all([
      sendBatch(1, "New", "Attempt 1", 0),         // Touch 1: нові ліди
      sendBatch(2, "Attempt 1", "Attempt 2", 2),    // Touch 2: 2 дні після Touch 1
      sendBatch(3, "Attempt 2", "No Response", 3),   // Touch 3: 3 дні після Touch 2
    ]);

    // Mark as Cold: No Response older than 5 days
    const cold = await pool.query(`
      UPDATE lead_profiles SET status = 'Cold', updated_at = now()
      WHERE status = 'No Response' AND updated_at < now() - interval '5 days'
    `);

    return NextResponse.json({
      ok: true,
      results,
      cold: cold.rowCount,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
