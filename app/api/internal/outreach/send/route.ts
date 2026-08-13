/**
 * POST /api/internal/outreach/send
 * Автоматична відправка Touch 1/2/3 emails через Gmail SMTP.
 * Body: { artistId?: string, touchNum?: number, batchSize?: number }
 * - artistId: відправити конкретному артисту
 * - touchNum: 1, 2 або 3 (default: 1)
 * - batchSize: скільки артистів обробити (default: 10, max: 50)
 *
 * Env vars: GMAIL_USER, GMAIL_APP_PASSWORD
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";

export const maxDuration = 300; // 5 min for slow sends with 15-30s delays

// 5 subject + body variants per touch
const TOUCH1 = {
  subjects: [
    "Congrats on your recent Beatport chart entry | Promosound",
    "Noticed your Beatport chart movement",
    "Your track is climbing — quick thought",
    "Beatport charts + a brief idea for you",
    "Saw your chart entry — wanted to reach out",
  ],
  bodies: [
    (n: string) => `Hi ${n},\n\nSaw your recent appearance in the Beatport charts — great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,
    (n: string) => `Hi ${n},\n\nNoticed your track charting on Beatport — well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,
    (n: string) => `Hi ${n},\n\nYour Beatport chart entry caught my attention — impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum — the window right after a chart entry.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,
    (n: string) => `Hey ${n},\n\nCongrats on the Beatport chart placement — that's a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more about how we approach it.\n\nMax`,
    (n: string) => `Hi ${n},\n\nJust spotted your track on the Beatport charts — nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`,
  ],
};

const TOUCH2 = {
  subjects: [
    "Re: chart momentum",
    "Quick follow-up on my previous note",
    "Circling back — your Beatport momentum",
    "Following up — still relevant?",
    "Re: your chart entry — brief follow-up",
  ],
  bodies: [
    (n: string) => `Hi ${n},\n\nJust wanted to briefly follow up in case my previous message got buried.\n\nWhen a track starts moving in the charts, there's usually a short window where additional exposure can significantly amplify results.\n\nIf you're open to it, I can outline how we typically approach this stage for electronic releases.\n\nBest,\nMax`,
    (n: string) => `Hi ${n},\n\nFollowing up quickly — I reached out a few days ago about your chart entry.\n\nThe timing window for amplifying chart momentum is usually pretty short, so wanted to make sure this landed on your radar.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,
    (n: string) => `Hey ${n},\n\nJust a quick nudge in case my last email slipped through.\n\nYour track is still in a great position to benefit from targeted promotion — we've seen similar artists extend their chart run significantly at this stage.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,
    (n: string) => `Hi ${n},\n\nWanted to circle back briefly. I wrote to you recently about your Beatport chart activity.\n\nWe work with artists at exactly this stage — when there's real chart traction to build on. No pressure, just wanted to make sure you saw the offer.\n\nCheers,\nMax`,
    (n: string) => `Hi ${n},\n\nShort follow-up — I mentioned PromoSound a few days back regarding your chart entry.\n\nIf you're still riding the momentum, we could potentially help extend it. If the timing isn't right, totally understand.\n\nBest,\nMax`,
  ],
};

const TOUCH3 = {
  subjects: [
    "Should I close the loop?",
    "Last check-in — no worries either way",
    "One final note before I step back",
    "Closing out — best of luck with the release",
    "Final follow-up from PromoSound",
  ],
  bodies: [
    (n: string) => `Hi ${n},\n\nI'll keep this short — just wanted to check once more before I step back.\n\nIf building on your recent chart momentum is something you'd like to explore, I'd be glad to connect.\n\nIf now isn't the right time, no worries at all — wishing you continued success with the release.\n\nBest,\nMax`,
    (n: string) => `Hi ${n},\n\nThis will be my last note — don't want to crowd your inbox.\n\nIf you ever want to explore promotion support for a future release, feel free to reach out anytime.\n\nWishing you all the best with your music.\n\nMax`,
    (n: string) => `Hey ${n},\n\nJust a final check-in. If this isn't the right time, I completely get it.\n\nThe door's always open if you'd like to work together down the line. Keep up the great work.\n\nCheers,\nMax`,
    (n: string) => `Hi ${n},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit right now.\n\nIf a future release hits the charts and you'd like a promotion partner, I'm an email away.\n\nAll the best,\nMax`,
    (n: string) => `Hi ${n},\n\nLast note from me — I'll step back after this.\n\nIf supporting your chart momentum is something you'd like to revisit later, feel free to get in touch whenever.\n\nGood luck with everything.\n\nBest,\nMax`,
  ],
};

const TOUCHES = [TOUCH1, TOUCH2, TOUCH3];

const SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nSPOTIFY PROMO: https://promosoundgroup.net/collections/spotify-promotion\nBEATPORT PROMO: https://promosoundgroup.net/collections/beatport-top-100-promotion\nSOUNDCLOUD PROMO: https://promosoundgroup.net/collections/soundcloud-promotion\nPROMOSOUND: https://promosoundgroup.net/`;

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD not set");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const touchNum = Math.min(Math.max(body.touchNum || 1, 1), 3);
    const batchSize = Math.min(Math.max(body.batchSize || 5, 1), 10);
    const specificArtistId = body.artistId as string | undefined;

    const touch = TOUCHES[touchNum - 1];
    const statusMap: Record<number, { from: string; to: string }> = {
      1: { from: "New", to: "Attempt 1" },
      2: { from: "Attempt 1", to: "Attempt 2" },
      3: { from: "Attempt 2", to: "No Response" },
    };
    const { from: fromStatus, to: toStatus } = statusMap[touchNum];

    // Get artists to send to
    let query: string;
    let params: (string | number)[];

    if (specificArtistId) {
      query = `
        SELECT DISTINCT ON (ac.artist_beatport_id)
          ac.artist_beatport_id as id, am.artist_name as name, ac.value as email
        FROM artist_contacts ac
        JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
        WHERE ac.artist_beatport_id = $1 AND ac.type = 'email' AND ac.confidence >= 0.65
          AND (ac.status IS NULL OR ac.status = 'ok')
          AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
        ORDER BY ac.artist_beatport_id, ac.confidence DESC
      `;
      params = [specificArtistId];
    } else {
      query = `
        SELECT DISTINCT ON (ac.artist_beatport_id)
          ac.artist_beatport_id as id, am.artist_name as name, ac.value as email
        FROM artist_contacts ac
        JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
        LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
        WHERE ac.type = 'email' AND ac.confidence >= 0.65
          AND (ac.status IS NULL OR ac.status = 'ok')
          AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
          AND (lp.status IS NULL OR lp.status = $1)
        ORDER BY ac.artist_beatport_id, ac.confidence DESC
        LIMIT $2
      `;
      params = [fromStatus, batchSize];
    }

    const leads = await pool.query<{ id: string; name: string; email: string }>(query, params);

    if (leads.rows.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "No leads to send" });
    }

    const transporter = getTransporter();
    let sent = 0;
    const results: { name: string; email: string; ok: boolean; error?: string }[] = [];

    for (const lead of leads.rows) {
      // Random delay 15-30s between emails to look natural
      if (sent > 0) await new Promise(r => setTimeout(r, 15000 + Math.random() * 15000));
      const variant = hashId(lead.id) % touch.subjects.length;
      const subject = touch.subjects[variant];
      const text = touch.bodies[variant](lead.name) + SIGNATURE;

      // Get ALL valid emails for this artist (TO + CC)
      const allEmails = await pool.query<{ value: string }>(
        `SELECT value FROM artist_contacts
         WHERE artist_beatport_id = $1 AND type = 'email' AND confidence >= 0.65
           AND (status IS NULL OR status = 'ok')
           AND LOWER(value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
         ORDER BY confidence DESC`,
        [lead.id]
      );
      const primaryEmail = allEmails.rows[0]?.value || lead.email;
      const ccEmails = allEmails.rows.slice(1).map(r => r.value);

      try {
        await transporter.sendMail({
          from: `"Max from PromoSound" <${process.env.GMAIL_USER}>`,
          to: primaryEmail,
          cc: ccEmails.length > 0 ? ccEmails.join(", ") : undefined,
          subject,
          text,
        });

        // Update status
        await pool.query(
          `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (artist_beatport_id) DO UPDATE SET status = $2, updated_at = now()`,
          [lead.id, toStatus]
        );

        // Record outreach event
        await pool.query(
          `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
           VALUES ($1, $2, 'email', $3, now(), $4)`,
          [lead.id, `email_touch_${touchNum}`, lead.email, toStatus]
        );

        sent++;
        results.push({ name: lead.name, email: lead.email, ok: true });
      } catch (e) {
        results.push({ name: lead.name, email: lead.email, ok: false, error: String(e) });
      }
    }

    return NextResponse.json({ ok: true, sent, total: leads.rows.length, touchNum, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
