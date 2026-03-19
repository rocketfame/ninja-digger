/**
 * GET /api/internal/stats
 * Global outreach statistics for dashboard.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      bpTotal, bpWithEmail, bpStatuses,
      raTotal, raWithEmail, raStatuses,
      sentToday, sentYesterday, sentTotal,
      raSentToday, raSentTotal,
      bouncedCount,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*) as c FROM lead_scores"),
      pool.query("SELECT COUNT(DISTINCT artist_beatport_id) as c FROM artist_contacts WHERE type='email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced')"),
      pool.query("SELECT status, COUNT(*) as c FROM lead_profiles GROUP BY status ORDER BY c DESC"),
      pool.query("SELECT COUNT(*) as c FROM ra_promoters").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type='email' AND status != 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT status, COUNT(*) as c FROM ra_promoter_profiles GROUP BY status ORDER BY c DESC").catch(() => ({ rows: [] })),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE - 1 AND sent_at < CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as c FROM outreach_events"),
      pool.query("SELECT COUNT(*) as c FROM ra_promoter_profiles WHERE status = 'Attempt 1' AND updated_at >= CURRENT_DATE").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM ra_promoter_profiles WHERE status != 'New'").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM artist_contacts WHERE status = 'bounced'"),
    ]);

    return NextResponse.json({
      beatport: {
        total: Number(bpTotal.rows[0]?.c ?? 0),
        withEmail: Number(bpWithEmail.rows[0]?.c ?? 0),
        statuses: bpStatuses.rows,
      },
      ra: {
        total: Number(raTotal.rows[0]?.c ?? 0),
        withEmail: Number(raWithEmail.rows[0]?.c ?? 0),
        statuses: raStatuses.rows,
      },
      outreach: {
        sentToday: Number(sentToday.rows[0]?.c ?? 0),
        sentYesterday: Number(sentYesterday.rows[0]?.c ?? 0),
        sentTotal: Number(sentTotal.rows[0]?.c ?? 0),
        raSentToday: Number(raSentToday.rows[0]?.c ?? 0),
        raSentTotal: Number(raSentTotal.rows[0]?.c ?? 0),
        bounced: Number(bouncedCount.rows[0]?.c ?? 0),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
