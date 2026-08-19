import { NextResponse } from "next/server";
import { buildFullReport } from "@/lib/reports";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const sent = await sendTelegramMessage(await buildFullReport());
  return NextResponse.json({ ok: true, sent: sent != null });
}
