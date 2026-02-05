/**
 * v2 — Cron: daily ingestion (Beatport only). After ingest runs normalize + score.
 */

import { NextResponse } from "next/server";
import { runIngest, getAvailableSources } from "@/ingest/run";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

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
  const chartFamilyParam = searchParams.get("chart_family");
  const chartFamily = chartFamilyParam
    ? chartFamilyParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
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

  console.log("[cron/ingest] start", { source: sourceSlug, chartDate, chartFamily });
  try {
    const result = await runIngest(sourceSlug, chartDate, { chartFamily });
    let metricsUpdated = 0;
    let scoresUpdated = 0;
    try {
      metricsUpdated = await refreshArtistMetrics();
      scoresUpdated = await refreshLeadScoresV2();
    } catch (e) {
      console.warn("normalize/score failed (run migration 013):", e);
    }
    console.log("[cron/ingest] end", {
      fetched: result.fetched,
      inserted: result.inserted,
      skipped: result.skipped,
      metricsUpdated,
      scoresUpdated,
    });
    return NextResponse.json({
      ok: true,
      source: result.sourceName,
      chartDate: result.chartDate,
      fetched: result.fetched,
      inserted: result.inserted,
      skipped: result.skipped,
      metricsUpdated,
      scoresUpdated,
    });
  } catch (err) {
    console.error("Cron ingest error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
