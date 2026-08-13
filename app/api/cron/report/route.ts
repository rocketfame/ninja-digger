/**
 * GET /api/cron/report — daily digest to Telegram (17:30 UTC ≈ 20:30 Kyiv):
 * leads found, contacts enriched, sends by touch, replies, opt-outs, queue.
 */

import { NextResponse } from "next/server";
import { buildDailyReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sent = await sendTelegramMessage(await buildDailyReport());
  return NextResponse.json({ ok: true, sent: sent != null, ts: new Date().toISOString() });
}
