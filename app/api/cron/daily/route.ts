/**
 * Один щоденний cron: discovery (раз на тиждень) + ingest + normalize + score.
 * Нічого не потрібно викликати вручну — Vercel Cron викликає цей URL за розкладом.
 */

import { NextResponse } from "next/server";
import { runBeatportDiscovery } from "@/ingest/discovery/runDiscovery";
import { runIngest } from "@/ingest/run";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — discovery може тривати

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chartDate = new Date().toISOString().slice(0, 10);
  const isSunday = new Date().getDay() === 0;

  const result: {
    ok: boolean;
    discovery?: { genresFetched: number; upserted: number; errors: string[] };
    ingest?: { fetched: number; inserted: number; skipped: number };
    metricsUpdated?: number;
    scoresUpdated?: number;
    error?: string;
  } = { ok: true };

  try {
    if (isSunday) {
      const discovery = await runBeatportDiscovery();
      result.discovery = {
        genresFetched: discovery.genresFetched,
        upserted: discovery.upserted,
        errors: discovery.errors,
      };
      if (process.env.NODE_ENV !== "test") {
        console.log("[cron/daily] discovery", discovery.upserted, "charts");
      }
    }

    const ingestResult = await runIngest("beatport", chartDate);
    result.ingest = {
      fetched: ingestResult.fetched,
      inserted: ingestResult.inserted,
      skipped: ingestResult.skipped,
    };

    const metricsUpdated = await refreshArtistMetrics();
    const scoresUpdated = await refreshLeadScoresV2();
    result.metricsUpdated = metricsUpdated;
    result.scoresUpdated = scoresUpdated;

    if (process.env.NODE_ENV !== "test") {
      console.log("[cron/daily] done", { ingest: result.ingest, metricsUpdated, scoresUpdated });
    }

    return NextResponse.json(result);
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[cron/daily]", result.error);
    return NextResponse.json(result, { status: 500 });
  }
}
