/**
 * Internal API: latest discovery run status for UI polling.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

type RunRow = {
  id: string;
  status: string;
  stage: string | null;
  progress: string | null;
  started_at: string;
  finished_at: string | null;
  charts_count: number | null;
  artists_count: number | null;
  leads_count: number | null;
  error_message: string | null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<RunRow>(
      `SELECT id, status, stage, progress,
              started_at::text AS started_at, finished_at::text AS finished_at,
              charts_count, artists_count, leads_count, error_message
       FROM discovery_runs
       ORDER BY started_at DESC
       LIMIT 1`
    );
    const run = rows[0] ?? null;
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[internal/discovery/status]", err);
    return NextResponse.json(
      { run: null, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
