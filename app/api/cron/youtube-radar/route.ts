/**
 * GET /api/cron/youtube-radar — YouTube "hot lead" discovery.
 * Finds recently-uploaded music videos, then reads each channel's description —
 * indie artists very often put a booking email + Spotify/link there. Upserts
 * into radar_leads (source='youtube'). No-ops until YOUTUBE_API_KEY is set.
 */
import { NextResponse } from "next/server";
import { extractEmail, extractUrl, computeHeat, upsertRadarLead } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const API = "https://www.googleapis.com/youtube/v3";
// Rotate query focus so we don't re-scan the same slice every run.
const QUERIES = ["new single official", "out now spotify", "official music video", "new EP", "unsigned artist", "prod by"];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ ok: true, skipped: "no YOUTUBE_API_KEY" });

  const q = QUERIES[new Date().getUTCHours() % QUERIES.length];
  const publishedAfter = new Date(Date.now() - 14 * 86400000).toISOString();
  const searchUrl = `${API}/search?part=snippet&type=video&videoCategoryId=10&order=date&maxResults=25&q=${encodeURIComponent(q)}&publishedAfter=${publishedAfter}&key=${key}`;
  const sres = await fetch(searchUrl).catch(() => null);
  if (!sres || !sres.ok) return NextResponse.json({ ok: false, error: "search failed", status: sres?.status ?? 0 }, { status: 502 });
  const sdata = (await sres.json().catch(() => ({}))) as { items?: { snippet?: { channelId?: string; publishedAt?: string } }[] };
  const items = sdata.items ?? [];
  const chanPub = new Map<string, string>();
  for (const it of items) {
    const cid = it.snippet?.channelId;
    if (cid && !chanPub.has(cid)) chanPub.set(cid, it.snippet?.publishedAt ?? "");
  }
  if (chanPub.size === 0) return NextResponse.json({ ok: true, scanned: 0, hot: 0 });

  const ids = [...chanPub.keys()].slice(0, 50).join(",");
  const cres = await fetch(`${API}/channels?part=snippet,statistics&id=${ids}&key=${key}`).catch(() => null);
  if (!cres || !cres.ok) return NextResponse.json({ ok: false, error: "channels failed" }, { status: 502 });
  const cdata = (await cres.json().catch(() => ({}))) as {
    items?: { id?: string; snippet?: { title?: string; description?: string; customUrl?: string }; statistics?: { subscriberCount?: string } }[];
  };

  const now = Date.now();
  let hot = 0, withEmail = 0;
  for (const ch of cdata.items ?? []) {
    const desc = ch.snippet?.description ?? "";
    const email = extractEmail(desc);
    const spotify = extractUrl(desc, "open\\.spotify\\.com|spotify\\.link");
    if (!email && !spotify) continue; // need something actionable
    const subs = parseInt(ch.statistics?.subscriberCount ?? "0", 10) || 0;
    const pub = chanPub.get(ch.id ?? "") ?? "";
    const releaseDays = pub ? Math.floor((now - Date.parse(pub)) / 86400000) : null;
    const heat = computeHeat({ releaseDays, hasIntent: false, followers: subs, hasEmail: !!email });
    const wrote = await upsertRadarLead({
      source: "youtube",
      handle: ch.id ?? ch.snippet?.customUrl ?? ch.snippet?.title ?? "",
      name: ch.snippet?.title ?? null,
      spotify_url: spotify,
      soundcloud_url: extractUrl(desc, "soundcloud\\.com"),
      email,
      email_source: email ? "yt_channel" : null,
      followers: subs,
      release_date: pub ? pub.slice(0, 10) : null,
      intent_signal: `fresh upload · ${subs.toLocaleString()} subs`,
      source_url: ch.snippet?.customUrl ? `https://youtube.com/${ch.snippet.customUrl}` : (ch.id ? `https://youtube.com/channel/${ch.id}` : null),
      heat_score: heat,
    }).catch(() => 0);
    if (wrote) { hot++; if (email) withEmail++; }
  }
  return NextResponse.json({ ok: true, scanned: chanPub.size, hot, withEmail, q, ts: new Date().toISOString() });
}
