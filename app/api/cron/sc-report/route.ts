/**
 * GET /api/cron/sc-report — daily SoundCloud parsing digest to Telegram
 * (17:00 UTC ≈ 20:00 Kyiv): emails found, artists harvested, promo channels
 * processed, promoters, DB size.
 */

import { NextResponse } from "next/server";
import { buildScReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sent = await sendTelegramMessage(await buildScReport());
  return NextResponse.json({ ok: true, sent: sent != null, ts: new Date().toISOString() });
}
