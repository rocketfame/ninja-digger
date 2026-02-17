/**
 * GET /api/internal/bptoptracker/last-date
 * Returns the latest snapshot_date that actually appears in the leads table:
 * max(snapshot_date) from chart_entries for bptoptracker charts. Fallback to bptoptracker_daily if no chart_entries yet.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const fromChartEntries = await query<{ max_date: string | null }>(
      `SELECT MAX(ce.snapshot_date)::text AS max_date
       FROM chart_entries ce
       JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'`
    );
    let lastSnapshotDate = fromChartEntries[0]?.max_date ?? null;
    if (lastSnapshotDate == null) {
      const fromDaily = await query<{ max_date: string | null }>(
        `SELECT MAX(snapshot_date)::text AS max_date FROM bptoptracker_daily`
      );
      lastSnapshotDate = fromDaily[0]?.max_date ?? null;
    }
    return NextResponse.json({ lastSnapshotDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
