/**
 * POST /api/internal/score
 * Recalculate lead_scores (segments + formula) from current artist_metrics.
 * No sync — use "Синхронізувати ретро з лідами" for full sync + score refresh.
 */

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { refreshLeadScoresV2 } from "@/segment/score";

export async function POST() {
  try {
    const updated = await refreshLeadScoresV2();
    revalidateTag("leads");
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
