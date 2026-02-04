/**
 * Beatport chart discovery: fetch genre index → chart URLs → upsert charts_catalog.
 * Mark charts not seen this run as is_active=false.
 * No chart entries ingestion here; only catalog.
 */

import { NextResponse } from "next/server";
import { runBeatportDiscovery } from "@/ingest/discovery/runDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runBeatportDiscovery();
    return NextResponse.json({
      ok: result.errors.length === 0,
      genresFetched: result.genresFetched,
      chartUrlsSeen: result.chartUrlsSeen,
      upserted: result.upserted,
      markedInactive: result.markedInactive,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Discover charts error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Discovery failed" },
      { status: 500 }
    );
  }
}
