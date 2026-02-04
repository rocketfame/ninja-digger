/**
 * Phase 2 (hybrid) — Cron endpoint for daily chart ingestion.
 * Primary source: beatport (chart mirror). Optional: ?source=songstats.
 * Vercel calls on schedule; CRON_SECRET optional.
 */

import { NextResponse } from "next/server";
import { runIngest, getAvailableSources } from "@/ingest/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const sourceSlug = searchParams.get("source") ?? "beatport";
  const chartDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);

  const available = getAvailableSources();
  if (!available.includes(sourceSlug)) {
    return NextResponse.json(
      { error: `Unknown source: ${sourceSlug}. Available: ${available.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await runIngest(sourceSlug, chartDate);
    return NextResponse.json({
      ok: true,
      source: result.sourceName,
      chartDate: result.chartDate,
      fetched: result.fetched,
      inserted: result.inserted,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error("Cron ingest error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
