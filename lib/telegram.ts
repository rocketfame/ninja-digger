/**
 * Telegram notifications via Bot API.
 * Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (user's chat).
 * No-op when not configured, so the pipeline never breaks on missing setup.
 */

/** Send a message; returns the Telegram message_id or null. */
export async function sendTelegramMessage(text: string): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error("[telegram] sendMessage failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { result?: { message_id?: number } };
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("[telegram] error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Escape user-provided strings for Telegram HTML parse mode. */
export function tgEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
