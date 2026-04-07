/**
 * POST /api/internal/ra/send
 * Send Touch 1/2/3 emails to RA promoter groups.
 * Body: { touchNum?: number, batchSize?: number, promoterId?: number }
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import * as nodemailer from "nodemailer";
import { RA_TOUCH1, RA_TOUCH2, RA_TOUCH3, RA_SIGNATURE, hashPromoterId } from "@/lib/raOutreach";

export const maxDuration = 300; // 5 min for slow sends

const TOUCHES = [RA_TOUCH1, RA_TOUCH2, RA_TOUCH3];

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const touchNum = Math.min(Math.max(body.touchNum || 1, 1), 3);
    const batchSize = Math.min(Math.max(body.batchSize || 5, 1), 20);

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return NextResponse.json({ ok: false, error: "GMAIL not configured" }, { status: 500 });

    const statusMap: Record<number, { from: string; to: string }> = {
      1: { from: "New", to: "Attempt 1" },
      2: { from: "Attempt 1", to: "Attempt 2" },
      3: { from: "Attempt 2", to: "No Response" },
    };
    const { from: fromStatus, to: toStatus } = statusMap[touchNum];
    const minDays = touchNum === 1 ? 0 : touchNum === 2 ? 2 : 3;

    // Get promoters to contact
    const leads = await pool.query<{
      promoter_id: number;
      name: string;
      email: string;
      event_name: string;
      city: string;
    }>(`
      SELECT DISTINCT ON (p.id)
        p.id as promoter_id, p.name, c.value as email,
        (SELECT e.name FROM ra_events e WHERE e.promoter_id = p.id AND e.event_date >= CURRENT_DATE ORDER BY e.event_date LIMIT 1) as event_name,
        p.city
      FROM ra_promoters p
      JOIN ra_promoter_contacts c ON p.id = c.promoter_id AND c.type = 'email' AND c.status NOT IN ('bounced', 'blocked') AND c.confidence >= 0.60
      LEFT JOIN ra_promoter_profiles pp ON p.id = pp.promoter_id
      WHERE (pp.status ${touchNum === 1 ? "IS NULL OR pp.status = 'New'" : `= '${fromStatus}'`})
        ${minDays > 0 ? `AND pp.updated_at < now() - interval '${minDays} days'` : ""}
        AND LOWER(c.value) NOT IN (SELECT email FROM email_blacklist)
      ORDER BY p.id, c.confidence DESC
      LIMIT $1
    `, [batchSize]);

    if (leads.rows.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "No RA leads to send" });
    }

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    const touch = TOUCHES[touchNum - 1];
    let sent = 0;
    const results: Array<{ name: string; email: string; ok: boolean }> = [];

    for (const lead of leads.rows) {
      if (sent > 0) await new Promise(r => setTimeout(r, 3000 + Math.random() * 15000));

      const v = hashPromoterId(lead.promoter_id) % touch.subjects.length;
      const subject = touch.subjects[v];
      const text = touchNum === 1
        ? (touch.bodies[v] as (n: string, e: string, c: string) => string)(lead.name, lead.event_name || "", lead.city || "") + RA_SIGNATURE
        : (touch.bodies[v] as (n: string) => string)(lead.name) + RA_SIGNATURE;

      // Get all emails for CC
      const allEmails = await pool.query<{ value: string }>(
        `SELECT value FROM ra_promoter_contacts
         WHERE promoter_id = $1 AND type = 'email' AND status NOT IN ('bounced', 'blocked') AND confidence >= 0.60
           AND LOWER(value) NOT IN (SELECT email FROM email_blacklist)
         ORDER BY confidence DESC`,
        [lead.promoter_id]
      );
      const primaryEmail = allEmails.rows[0]?.value || lead.email;
      const ccEmails = allEmails.rows.slice(1).map(r => r.value);

      try {
        await transporter.sendMail({
          from: `"Max from PromoSound" <${user}>`,
          to: primaryEmail,
          cc: ccEmails.length > 0 ? ccEmails.join(", ") : undefined,
          subject,
          text,
        });

        await pool.query(
          `INSERT INTO ra_promoter_profiles (promoter_id, status, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (promoter_id) DO UPDATE SET status = $2, updated_at = now()`,
          [lead.promoter_id, toStatus]
        );
        sent++;
        results.push({ name: lead.name, email: primaryEmail, ok: true });
      } catch (e) {
        results.push({ name: lead.name, email: primaryEmail, ok: false });
      }
    }

    return NextResponse.json({ ok: true, sent, total: leads.rows.length, touchNum, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// GET handler for Vercel Cron — cycles through Touch 1, 2, 3
export async function GET() {
  const allResults: Array<{ touch: number; sent: number; total: number; results?: unknown[] }> = [];

  for (const touchNum of [1, 2, 3]) {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touchNum, batchSize: 5 }),
    });
    const resp = await POST(req);
    const data = await resp.json();
    allResults.push({ touch: touchNum, sent: data.sent ?? 0, total: data.total ?? 0, results: data.results });
  }

  const totalSent = allResults.reduce((s, r) => s + r.sent, 0);
  console.log(`[ra-send-cron] Sent ${totalSent} emails: T1=${allResults[0].sent}, T2=${allResults[1].sent}, T3=${allResults[2].sent}`);

  return NextResponse.json({ ok: true, source: "cron", totalSent, touches: allResults });
}
