/**
 * POST /api/internal/ra/enrich
 * Enrich promoter contacts: RA profile → website → email.
 * Body: { promoterId?: number, batchSize?: number }
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { enrichPromoter } from "@/lib/raEvents";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const specificId = body.promoterId as number | undefined;
    const batchSize = Math.min(body.batchSize || 10, 30);

    let promoters: Array<{ id: number; name: string }>;

    if (specificId) {
      const r = await pool.query<{ id: number; name: string }>(
        "SELECT id, name FROM ra_promoters WHERE id = $1",
        [specificId]
      );
      promoters = r.rows;
    } else {
      // Get promoters without email contacts
      const r = await pool.query<{ id: number; name: string }>(`
        SELECT p.id, p.name
        FROM ra_promoters p
        LEFT JOIN ra_promoter_contacts c ON p.id = c.promoter_id AND c.type = 'email'
        WHERE c.id IS NULL
        ORDER BY p.follower_count DESC NULLS LAST
        LIMIT $1
      `, [batchSize]);
      promoters = r.rows;
    }

    let totalLinks = 0;
    let totalEmails = 0;
    const results: Array<{ name: string; links: number; emails: number }> = [];

    for (const p of promoters) {
      const { linksFound, emailsFound } = await enrichPromoter(p.id);
      totalLinks += linksFound;
      totalEmails += emailsFound;
      results.push({ name: p.name, links: linksFound, emails: emailsFound });

      // Rate limit
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
    }

    return NextResponse.json({
      ok: true,
      enriched: promoters.length,
      totalLinks,
      totalEmails,
      results,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// GET handler for Vercel Cron — increased batch for faster processing
export async function GET() {
  const req = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchSize: 15 }) });
  return POST(req);
}
