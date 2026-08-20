/**
 * GET /api/internal/report/telegram — pushes the full 3-channel report to the
 * owner's Telegram chat. Only ever sends to TELEGRAM_CHAT_ID, so it's safe to
 * trigger on demand.
 */
import { NextResponse } from "next/server";
import { buildFullReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const report = await buildFullReport();
  const id = await sendTelegramMessage(report).catch(() => null);
  return NextResponse.json({ ok: id != null, sent: id != null });
}
