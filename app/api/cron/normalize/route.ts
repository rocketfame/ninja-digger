/**
 * v2 — Cron: aggregate chart_entries → artist_metrics.
 */

import { NextResponse } from "next/server";
import { refreshArtistMetrics } from "@/segment/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const updated = await refreshArtistMetrics();
    console.log("[cron/normalize] refresh_artist_metrics:", updated);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    console.error("Cron normalize error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Normalize failed" },
      { status: 500 }
    );
  }
}
