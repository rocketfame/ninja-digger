/**
 * Minimal Claude client for reply-assist (mode A: draft-and-approve).
 * No-ops (returns null) until ANTHROPIC_API_KEY is set, so the inbox cron works
 * unchanged until the key is added.
 */

const MODEL = "claude-haiku-4-5-20251001"; // cheap + fast, plenty for classify+draft

type Draft = { intent: string; reply: string } | null;

/**
 * Read an artist's reply and return {intent, reply}: a classification plus a
 * ready-to-send draft response in the artist's language. Returns null on no key
 * or any error (so the caller just skips the suggestion).
 */
export async function draftReplyAssist(artistReply: string, ctx?: { name?: string | null; channel?: string }): Promise<Draft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !artistReply?.trim()) return null;

  const system =
    `You are the assistant for Max at PromoSound, a music promo agency (Beatport, SoundCloud, Spotify, YouTube promotion packages). ` +
    `An artist just REPLIED to our cold outreach. Read their reply and respond as JSON only: ` +
    `{"intent":"interested|question|not_interested|unsubscribe|other","reply":"<a short, warm, human 1:1 reply in the SAME language as the artist, plain text, no signature>"}. ` +
    `If interested or a question: move it forward naturally, offer to send the package breakdown / hop on a quick chat, keep it casual and specific. ` +
    `If not_interested or unsubscribe: a brief polite acknowledgement, do NOT pitch. Never invent prices or fake claims.`;

  const user = `Artist${ctx?.name ? ` (${ctx.name})` : ""}${ctx?.channel ? ` [via ${ctx.channel}]` : ""} replied:\n"""${artistReply.slice(0, 1500)}"""`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as { intent?: string; reply?: string };
    if (!parsed.reply) return null;
    return { intent: parsed.intent || "other", reply: parsed.reply };
  } catch {
    return null;
  }
}
