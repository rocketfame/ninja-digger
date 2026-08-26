/**
 * GET /api/internal/reply-assist/test?text=...&name=...&channel=...
 * Quick manual test of the reply-assist draft (mode A). Returns {intent, reply}
 * or a hint if ANTHROPIC_API_KEY isn't live yet. Text length capped.
 */
import { NextResponse } from "next/server";
import { draftReplyAssist } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const text = (sp.get("text") || "").slice(0, 1000);
  const name = sp.get("name") || null;
  const channel = sp.get("channel") || "Spotify";
  if (!text) return NextResponse.json({ ok: false, error: "pass ?text=" }, { status: 400 });
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const draft = await draftReplyAssist(text, { name, channel });
  return NextResponse.json({
    ok: true,
    anthropicKeyPresent: hasKey,
    result: draft ?? null,
    note: draft ? undefined : hasKey ? "LLM returned null (API error?)" : "no ANTHROPIC_API_KEY on this deployment — redeploy after adding it",
  });
}
