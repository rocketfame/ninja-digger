/**
 * Oracle Mode: Add scanned chart to main pipeline (catalog + ingest + normalize + score).
 * POST body: { url: string }
 * Ensures chart in charts_catalog, ingests entries, runs normalize + score.
 */

import { NextResponse } from "next/server";
import { ensureChartInCatalogAndIngest } from "@/ingest/run";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "URL is required." },
        { status: 400 }
      );
    }
    if (!url.includes("beatport.com")) {
      return NextResponse.json(
        { ok: false, error: "Only Beatport chart URLs are supported for Add to Leads." },
        { status: 400 }
      );
    }

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const { chartId, result } = await ensureChartInCatalogAndIngest(url, snapshotDate);
    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();

    return NextResponse.json({
      ok: true,
      chartId,
      ingested: result.inserted,
      skipped: result.skipped,
      metricsUpdated,
      scoresUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
