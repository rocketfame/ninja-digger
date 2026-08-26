/**
 * Telegram notifications via Bot API.
 * Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (user's chat).
 * No-op when not configured, so the pipeline never breaks on missing setup.
 */

export type InlineButton = { text: string; callback_data?: string; url?: string };

/** Send a message; returns the Telegram message_id or null. */
export async function sendTelegramMessage(text: string, keyboard?: InlineButton[][]): Promise<number | null> {
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
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
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

/** Acknowledge an inline-button press (stops the loading spinner). Optional
 * text shows a toast/alert to the user for instant feedback. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string, alert = false): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text, show_alert: alert } : {}) }),
  }).catch(() => {});
}

/** Send a message that pops the user's keyboard pre-focused to reply to it
 * (force_reply). The user's reply to this message routes through the normal
 * reply handler — used for the "✏️ Edit" flow so no swipe is needed. */
export async function sendForceReply(text: string): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: { force_reply: true, input_field_placeholder: "Ваш варіант відповіді…" },
      }),
    });
    const data = (await res.json()) as { result?: { message_id?: number } };
    return data.result?.message_id ?? null;
  } catch { return null; }
}

/** Replace (or clear) a message's inline buttons — e.g. remove "Approve" after
 * it's been used so the same draft can't be sent twice. */
export async function editMessageReplyMarkup(messageId: number, keyboard?: InlineButton[][]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard ?? [] } }),
  }).catch(() => {});
}
