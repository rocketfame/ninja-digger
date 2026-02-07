/**
 * POST /api/internal/bptoptracker/clean
 * Deletes UI/nav junk (blocklist) from bptoptracker_daily, then from lead_scores and artist_metrics
 * so "About us" etc. don't appear in segments.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";

export async function POST() {
  try {
    const blocklist = getBlocklistValuesForSql();
    if (blocklist.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0, deletedLeads: 0, deletedMetrics: 0 });
    }

    const dailyResult = await pool.query(
      `DELETE FROM bptoptracker_daily WHERE LOWER(TRIM(artist_name)) = ANY($1::text[])`,
      [blocklist]
    );
    const deleted = dailyResult.rowCount ?? 0;

    const leadResult = await pool.query(
      `DELETE FROM lead_scores WHERE artist_beatport_id IN (
        SELECT artist_beatport_id FROM artist_metrics WHERE LOWER(TRIM(artist_name)) = ANY($1::text[])
      )`,
      [blocklist]
    );
    const deletedLeads = leadResult.rowCount ?? 0;

    const metricsResult = await pool.query(
      `DELETE FROM artist_metrics WHERE LOWER(TRIM(artist_name)) = ANY($1::text[])`,
      [blocklist]
    );
    const deletedMetrics = metricsResult.rowCount ?? 0;

    return NextResponse.json({
      ok: true,
      deleted,
      deletedLeads,
      deletedMetrics,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
