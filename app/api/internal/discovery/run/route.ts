/**
 * Internal API: manually trigger discovery → ingest → normalize → score.
 * Same pipeline as cron; writes progress to discovery_runs for UI.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runDiscoveryPipeline } from "@/lib/discoveryPipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const insert = await pool.query<{ id: string }>(
      `INSERT INTO discovery_runs (status, stage, progress, started_at)
       VALUES ('running', 'discovery', 'Starting…', now())
       RETURNING id`
    );
    const runId = insert.rows[0]?.id;
    if (!runId) {
      return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
    }

    await runDiscoveryPipeline(runId);

    const row = await pool.query(
      `SELECT id, status, stage, progress, started_at, finished_at, charts_count, artists_count, leads_count, error_message
       FROM discovery_runs WHERE id = $1`,
      [runId]
    );
    const run = row.rows[0];
    return NextResponse.json({ ok: true, run });
  } catch (err) {
    console.error("[internal/discovery/run]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}
