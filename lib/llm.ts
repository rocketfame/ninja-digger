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
  ctx?: { name?: string | null; channel?: string; offer?: { name?: string; url?: string | null; code?: string | null }; facts?: string | null }
): Promise<Draft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !artistReply?.trim()) return null;

  // Concrete offer to pitch when the lead is warm. Built from app_settings so
  // the exact product name / link / discount code are editable without a deploy.
  const o = ctx?.offer;
  const offerBlock = o?.name
    ? `\n\nOUR OFFER LINK (use when they are interested or ask about packages/reach/pricing/next steps): point them to "${o.name}" and put the link on ITS OWN LINE so they can browse the real packages and prices themselves: ${o.url ?? ""}.` +
      (o.code ? ` Mention the code ${o.code} as a personal discount from Max.` : ``) +
      ` Keep it to ONE short line plus the link - do NOT describe every package or invent prices; the link does the work.`
    : ``;

  const system =
    `You are the assistant for Max at PromoSound, a music-promo agency (we promote artists on Beatport, SoundCloud, Spotify and YouTube).\n\n` +
    `CONTEXT: our outreach opened by pointing at this artist's chart activity. When they ask "which track / am I charting", answer from the VERIFIED FACTS below (exact title, chart, positions, source link). Never call anything a "recent upload" or "new release" unless the facts say it was released recently; a CATALOG/classic track that re-enters the charts is described as exactly that (renewed interest in a classic), and the pitch then shifts to their NEXT release or catalog push.\n\n` +
    `READ THE REPLY CAREFULLY. If the artist corrects us (the track is old, it isn't theirs, they are a label/manager, they already work with someone, they are annoyed), acknowledge the correction in ONE short sentence, do NOT repeat our original framing, and either adjust the offer to what fits or close politely. Sarcasm or irritation means: apologise briefly, no pitch. Never argue, never explain our tooling.\n\n` +
    `An artist just REPLIED to our outreach. Respond as JSON only: {"intent":"interested|question|not_interested|unsubscribe|other","reply":"<the reply text in the SAME language as the artist, plain text, no signature>"}.\n` +
    `STYLE (strict): keep it SHORT, 2 to 3 short sentences, never more. Direct and professional, zero filler and zero hype phrases ("that's exactly the right time", "sound good?", "let's capitalize"). Sound like a busy competent person, not a marketer. Use only plain punctuation: commas, periods, question marks, and a simple hyphen "-" if needed. NEVER use em-dashes or en-dashes ("—" / "–"). No bullet points, no headings, no emoji.\n` +
    `HARD RULE: NEVER propose a call, meeting, Zoom, phone, or "quick chat". All communication stays in email.\n` +
    `ANSWER WITH THE LINK, not a sales paragraph: when they ask what it looks like, what the reach is, or what packages/prices are available, DO NOT write a long descriptive pitch and NEVER deflect with "I'll send details later" (that brushes off a hot lead). Instead: one short line that it's all real listeners (never bots), then send them straight to our packages via the offer link below so they see the real options and prices, then ask ONE qualifying question (their main platform or their next release date). Let the link do the work - keep the whole reply to 2-3 sentences.\n` +
    `- interested / question: brief affirm, then the offer link + one qualifier. Short.\n` +
    `- not_interested / unsubscribe: a brief polite acknowledgement, do NOT pitch.\n` +
    `Never invent specific prices, exact numbers, chart positions, or fake guarantees. Be concrete about WHAT we do without fabricating stats.` +
    offerBlock +
    (ctx?.facts
      ? `\n\nVERIFIED FACTS about this artist from our own chart tracking (the ONLY numbers you may cite):\n${ctx.facts}\n` +
        `USE THEM: when they ask "which track?", "where did you see it?", "am I charting?" or what caught our attention, name the exact track title, the chart and the positions/dates from the facts, and ALWAYS include the BP Top Tracker artist history link on its own line right after naming the track (it is the source we track, so they can verify), and the Beatport track link only if they ask where to find the track. Never cite any position, date or track that is not in the facts.`
      : ``);

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
    let reply = parsed.reply.replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, "-");
    // Deterministic guarantee: when we cited chart facts, the reply must carry
    // the source link (BP Top Tracker artist history) so the artist can verify.
    const bptt = ctx?.facts?.match(/https:\/\/www\.bptoptracker\.com\/artist\/[^\s]+/)?.[0];
    if (bptt && !/bptoptracker\.com/.test(reply) && /chart|beatport|top 100/i.test(reply)) {
      const cut = reply.search(/[.!?](\s|$)/);
      reply = cut > 0 ? `${reply.slice(0, cut + 1)}\nChart history: ${bptt}\n${reply.slice(cut + 1).trimStart()}` : `${reply}\nChart history: ${bptt}`;
    }
    return { intent: parsed.intent || "other", reply };
  } catch {
    return null;
  }
}
