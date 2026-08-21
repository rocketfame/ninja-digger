/**
 * POST /api/internal/radar/playlisting — receives artists harvested from a
 * logged-in SubmitHub / Groover session (browser). These artists are PAYING to
 * submit tracks for promo right now — the highest-intent lead there is. Upserts
 * into radar_leads (source='playlisting'). CORS-open so the platform page can
 * POST directly.
 */
import { NextResponse } from "next/server";
import { extractEmail, extractUrl, computeHeat, upsertRadarLead } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() { return new NextResponse(null, { headers: CORS }); }

type Item = { handle?: string; name?: string; spotify_url?: string; email?: string; bio?: string; followers?: number; source_url?: string; platform?: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no items" }, { status: 400, headers: CORS });

  let upserted = 0, withEmail = 0;
  for (const it of items) {
    const handle = String(it.handle ?? it.spotify_url ?? it.name ?? "").trim();
    if (!handle) continue;
    const blob = `${it.bio ?? ""} ${it.spotify_url ?? ""} ${it.email ?? ""}`;
    const email = extractEmail(blob, it.email);
    const spotify = it.spotify_url ?? extractUrl(blob, "open\\.spotify\\.com|spotify\\.link");
    // Paying to submit = strong intent; heat gets the intent bonus.
    const heat = computeHeat({ releaseDays: 0, hasIntent: true, followers: it.followers ?? null, hasEmail: !!email });
    const wrote = await upsertRadarLead({
      source: "playlisting",
      handle,
      name: it.name ?? null,
      spotify_url: spotify,
      email,
      email_source: email ? "playlisting" : null,
      followers: it.followers ?? null,
      intent_signal: `paid submission${it.platform ? ` · ${it.platform}` : ""}`,
      source_url: it.source_url ?? null,
      heat_score: heat,
    }).catch(() => 0);
    if (wrote) { upserted++; if (email) withEmail++; }
  }
  return NextResponse.json({ ok: true, upserted, withEmail, received: items.length }, { headers: CORS });
}
