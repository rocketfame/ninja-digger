/**
 * GET /api/internal/report/telegram — pushes the unified 3-channel report to the
 * owner's Telegram chat (?period=Ранок|Вечір from the crons, or on demand).
 *
 * It only ever posts to TELEGRAM_CHAT_ID, so it cannot leak to a stranger — but
 * an open URL still lets a stranger make the owner's bot post on command, and
 * it was open: reachable from a bare curl with no key. Same gate as the other
 * internal routes; Vercel cron carries the CRON_SECRET bearer, so the scheduled
 * reports are unaffected.
 */
import { NextResponse } from "next/server";
import { buildFullReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const period = new URL(request.url).searchParams.get("period") ?? undefined;
  const report = await buildFullReport(period);
  const id = await sendTelegramMessage(report).catch(() => null);
  return NextResponse.json({ ok: id != null, sent: id != null });
}
