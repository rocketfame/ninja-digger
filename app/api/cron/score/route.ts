/**
 * v2 — Cron: artist_metrics → lead_scores (segments + formula).
 */

import { NextResponse } from "next/server";
import { refreshLeadScoresV2 } from "@/segment/score";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const updated = await refreshLeadScoresV2();
    console.log("[cron/score] refresh_lead_scores_v2:", updated);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    console.error("Cron score error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Score failed" },
      { status: 500 }
    );
  }
}
