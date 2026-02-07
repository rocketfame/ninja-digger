/**
 * POST /api/internal/bptoptracker/clean
 * Deletes from bptoptracker_daily where artist_name is UI/nav text (blocklist).
 * Run after fixing parser to remove already-inserted junk.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";

export async function POST() {
  try {
    const blocklist = getBlocklistValuesForSql();
    if (blocklist.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }
    const result = await pool.query(
      `DELETE FROM bptoptracker_daily WHERE LOWER(TRIM(artist_name)) = ANY($1::text[])`,
      [blocklist]
    );
    const deleted = result.rowCount ?? 0;
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
