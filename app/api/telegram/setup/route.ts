/**
 * GET /api/telegram/setup — (re)register the Telegram webhook with the current
 * TELEGRAM_WEBHOOK_SECRET and return getWebhookInfo. Protected by CRON_SECRET.
 * Use this to fix a silent bot (callbacks/replies not processed) after a secret
 * rotation or a missing/incorrect webhook registration.
 *
 *   GET /api/telegram/setup?info=1   → just report getWebhookInfo (no changes)
 *   GET /api/telegram/setup          → setWebhook + report
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });

  const base = "https://ninja-digger.vercel.app";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const infoOnly = new URL(request.url).searchParams.get("info") === "1";

  const api = async (method: string, body?: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return res.json().catch(() => ({ ok: false, description: "bad json" }));
  };

  let setResult: unknown = null;
  if (!infoOnly) {
    setResult = await api("setWebhook", {
      url: `${base}/api/telegram/webhook`,
      secret_token: webhookSecret || undefined,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  }
  const info = await api("getWebhookInfo");
  return NextResponse.json({
    ok: true,
    hasWebhookSecret: Boolean(webhookSecret),
    setResult,
    info,
  });
}
