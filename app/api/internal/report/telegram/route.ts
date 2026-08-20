/**
 * GET /api/internal/report/telegram — pushes the unified 3-channel report to the
 * owner's Telegram chat. Only ever sends to TELEGRAM_CHAT_ID, so it's safe to
 * trigger on demand or from the morning/evening crons (?period=Ранок|Вечір).
 */
import { NextResponse } from "next/server";
import { buildFullReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? undefined;
  const report = await buildFullReport(period);
  const id = await sendTelegramMessage(report).catch(() => null);
  return NextResponse.json({ ok: id != null, sent: id != null });
}
