/**
 * GET /api/cron/pipeline
 * Hourly pipeline — Beatport outreach only (fast, no self-fetch).
 * RA outreach runs via separate /api/cron/ra endpoint.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";

export const maxDuration = 55;

const SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nSPOTIFY PROMO: https://promosoundgroup.net/collections/spotify-promotion\nBEATPORT PROMO: https://promosoundgroup.net/collections/beatport-top-100-promotion\nSOUNDCLOUD PROMO: https://promosoundgroup.net/collections/soundcloud-promotion\nPROMOSOUND: https://promosoundgroup.net/`;

const T1_SUBJECTS = ["Congrats on your recent Beatport chart entry | Promosound","Noticed your Beatport chart movement","Your track is climbing — quick thought","Beatport charts + a brief idea for you","Saw your chart entry — wanted to reach out"];
const T1_BODIES = [(n:string)=>`Hi ${n},\n\nSaw your recent appearance in the Beatport charts — great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,(n:string)=>`Hi ${n},\n\nNoticed your track charting on Beatport — well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,(n:string)=>`Hi ${n},\n\nYour Beatport chart entry caught my attention — impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,(n:string)=>`Hey ${n},\n\nCongrats on the Beatport chart placement — that's a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more.\n\nMax`,(n:string)=>`Hi ${n},\n\nJust spotted your track on the Beatport charts — nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function sendBeatportBatch(touchNum: number, fromStatus: string, toStatus: string, minDays: number) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return 0;

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });

  const leads = await pool.query<{ id: string; name: string; email: string }>(`
    SELECT DISTINCT ON (ac.artist_beatport_id)
      ac.artist_beatport_id as id, am.artist_name as name, ac.value as email
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email' AND ac.confidence >= 0.65 AND (ac.status IS NULL OR ac.status != 'bounced')
      AND (lp.status ${touchNum === 1 ? "IS NULL OR lp.status = 'New'" : `= '${fromStatus}'`})
      ${minDays > 0 ? `AND lp.updated_at < now() - interval '${minDays} days'` : ""}
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
    LIMIT 10
  `);

  let sent = 0;
  for (const lead of leads.rows) {
    if (sent > 0) await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
    const v = hashId(lead.id) % T1_SUBJECTS.length;
    try {
      const allEmails = await pool.query<{ value: string }>(
        `SELECT value FROM artist_contacts WHERE artist_beatport_id = $1 AND type = 'email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced') ORDER BY confidence DESC`,
        [lead.id]
      );
      await transporter.sendMail({
        from: `"Max from PromoSound" <${user}>`,
        to: allEmails.rows[0]?.value || lead.email,
        cc: allEmails.rows.slice(1).map(r => r.value).join(", ") || undefined,
        subject: T1_SUBJECTS[v],
        text: T1_BODIES[v](lead.name) + SIGNATURE,
      });
      await pool.query(
        `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status = $2, updated_at = now()`,
        [lead.id, toStatus]
      );
      sent++;
    } catch { /* skip */ }
  }
  return sent;
}

export async function GET() {
  const hour = new Date().getUTCHours();
  const rand = Math.random();
  const actions: string[] = [];

  // Beatport outreach: 60% chance, skip night
  if (hour >= 6 && hour <= 21 && rand < 0.65) {
    const t1 = await sendBeatportBatch(1, "New", "Attempt 1", 0);
    const t2 = await sendBeatportBatch(2, "Attempt 1", "Attempt 2", 2);
    const t3 = await sendBeatportBatch(3, "Attempt 2", "No Response", 3);
    if (t1 + t2 + t3 > 0) actions.push(`bp: T1=${t1} T2=${t2} T3=${t3}`);
  }

  // Cold marking: 5% chance
  if (rand < 0.05) {
    const cold = await pool.query(`UPDATE lead_profiles SET status = 'Cold', updated_at = now() WHERE status = 'No Response' AND updated_at < now() - interval '5 days'`);
    if ((cold.rowCount ?? 0) > 0) actions.push(`cold: ${cold.rowCount}`);
  }

  return NextResponse.json({ ok: true, hour, rand: Math.round(rand * 100) / 100, actions: actions.length > 0 ? actions : ["idle"], ts: new Date().toISOString() });
}
