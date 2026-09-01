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
export async function draftReplyAssist(
  artistReply: string,
  ctx?: { name?: string | null; channel?: string; offer?: { name?: string; url?: string | null; code?: string | null } }
): Promise<Draft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !artistReply?.trim()) return null;

  // Concrete offer to pitch when the lead is warm. Built from app_settings so
  // the exact product name / link / discount code are editable without a deploy.
  const o = ctx?.offer;
  const offerBlock = o?.name
    ? `\n\nOUR CONCRETE OFFER (pitch this when they are interested or asking about pricing/next steps): "${o.name}" — a daily promotion designed to support and improve an existing chart position. Name it plainly, in one line.` +
      (o.code ? ` Then share the discount code ${o.code} as a special personal discount from Max.` : ``) +
      (o.url ? ` Include this link on its own line: ${o.url}` : ``) +
      ` Do not stack multiple offers or invent prices.`
    : ``;

  const system =
    `You are the assistant for Max at PromoSound, a music-promo agency (we promote artists on Beatport, SoundCloud, Spotify and YouTube).\n\n` +
    `IMPORTANT CONTEXT: our outreach always opens by pointing out something POSITIVE about this artist, like their track appearing or moving in the Beatport charts, a strong recent upload, or real traction. So when they ask "am I charting?" / "am I in top Beatport?" / "is my track doing well?", AFFIRM it warmly and confidently (yes, their track has been showing up and getting traction, that's exactly why we reached out) and use that momentum. Do NOT hedge with "it depends" or undercut the framing we set.\n\n` +
    `WINNING ANGLE: they are already in the charts, so the goal now is to push HIGHER while the momentum is there. Lead with that idea.\n\n` +
    `An artist just REPLIED to our outreach. Respond as JSON only: {"intent":"interested|question|not_interested|unsubscribe|other","reply":"<the reply text in the SAME language as the artist, plain text, no signature>"}.\n` +
    `STYLE (strict): keep it SHORT, 2 to 4 short sentences. Direct and professional, zero filler and zero hype phrases ("that's exactly the right time", "sound good?", "let's capitalize"). Sound like a busy competent person, not a marketer. Use only plain punctuation: commas, periods, question marks, and a simple hyphen "-" if needed. NEVER use em-dashes or en-dashes ("—" / "–"). No bullet points, no headings, no emoji.\n` +
    `HARD RULE: NEVER propose a call, meeting, Zoom, phone, or "quick chat". All communication stays in email.\n` +
    `ANSWER THE QUESTION: when they ask what it looks like, what the reach is, or what packages are available, ANSWER IT in THIS email with substance. Never deflect with "I'll send details in the next email" or "I'll send a breakdown later" - that reads as a brush-off to a hot lead. Describe concretely what we do: real playlist placements and streams on Spotify/Apple, targeted YouTube views and channel promotion, all real listeners (never bots). Explain we build the package around their specific release/goal, and ask ONE qualifying question (their main platform or their next release date) so we can tailor it. If an offer link is provided below, include it.\n` +
    `- interested / question: affirm the momentum briefly, then give the substantive answer above (what we do + tailor to them + one qualifier).\n` +
    `- not_interested / unsubscribe: a brief polite acknowledgement, do NOT pitch.\n` +
    `Never invent specific prices, exact numbers, chart positions, or fake guarantees. Be concrete about WHAT we do without fabricating stats.` +
    offerBlock;

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
    // Deterministic cleanup: the model occasionally ignores the no-dash rule.
    const reply = parsed.reply.replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, "-");
    return { intent: parsed.intent || "other", reply };
  } catch {
    return null;
  }
}
