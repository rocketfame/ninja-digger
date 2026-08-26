/**
 * GET /api/cron/youtube-radar — YouTube "hot lead" discovery.
 * Finds recently-uploaded music videos, reads each channel's description —
 * indie artists and (especially) beat producers put a booking/lease email +
 * Spotify/links there. Upserts into radar_leads (source='youtube').
 * No-ops until YOUTUBE_API_KEY is set.
 *
 * Throughput: 3 searches/run × 50 results, hourly = ~3,600 channels/day scanned
 * at ~7.5k of the 10k daily quota units (search=100, channels=~5). Queries are
 * weighted to niches that reliably expose contact info, so the email hit-rate
 * is far higher than generic "music video" scans.
 */
import { NextResponse } from "next/server";
import { extractEmail, extractUrl, computeHeat, upsertRadarLead } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API = "https://www.googleapis.com/youtube/v3";
const SEARCHES_PER_RUN = 3;   // 3 × 100 units × 24 runs = 7,200/day (quota 10k)
const RESULTS_PER_SEARCH = 50; // API max; same quota cost as 25

// Query pool, ordered so the highest email-yield niches come first. Beat
// producers ("type beat", "prod by") almost always list a lease/booking email;
// genre premieres and "out now" indie artists frequently link Spotify + contact.
const QUERIES = [
  "type beat 2026", "free type beat", "type beat", "prod by", "beat store",
  "melodic techno premiere", "afro house 2026", "drum and bass premiere",
  "techno premiere", "deep house new", "phonk 2026", "amapiano new",
  "future bass new", "trap new artist", "hip hop new artist", "lofi new",
  "new single out now", "out now spotify", "official music video 2026",
  "new EP", "unsigned artist", "independent artist new", "demo submission",
  "booking management music",
];
const LINK_RE = "open\\.spotify\\.com|spotify\\.link|soundcloud\\.com|linktr\\.ee|beacons\\.ai|bandcamp\\.com|band\\.link|hypeddit\\.com";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ ok: true, skipped: "no YOUTUBE_API_KEY" });

  // Rotate a fresh slice of the query pool each hour so we cover it all daily.
  const hour = new Date().getUTCHours();
  const queries = Array.from({ length: SEARCHES_PER_RUN }, (_, i) => QUERIES[(hour * SEARCHES_PER_RUN + i) % QUERIES.length]);
  const publishedAfter = new Date(Date.now() - 21 * 86400000).toISOString();

  // 1) Search each query → collect unique channelIds with their upload date.
  const chanPub = new Map<string, string>();
  let searched = 0;
  for (const q of queries) {
    const url = `${API}/search?part=snippet&type=video&videoCategoryId=10&order=date&maxResults=${RESULTS_PER_SEARCH}&q=${encodeURIComponent(q)}&publishedAfter=${publishedAfter}&key=${key}`;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) continue; // one query failing (e.g. transient) must not kill the run
    searched++;
    const data = (await res.json().catch(() => ({}))) as { items?: { snippet?: { channelId?: string; publishedAt?: string } }[] };
    for (const it of data.items ?? []) {
      const cid = it.snippet?.channelId;
      if (cid && !chanPub.has(cid)) chanPub.set(cid, it.snippet?.publishedAt ?? "");
    }
  }
  if (chanPub.size === 0) return NextResponse.json({ ok: true, searched, scanned: 0, hot: 0 });

  // 2) Hydrate channels in batches of 50 (channels.list id cap), read descriptions.
  const allIds = [...chanPub.keys()];
  const now = Date.now();
  let hot = 0, withEmail = 0, scanned = 0;
  for (let i = 0; i < allIds.length; i += 50) {
    const ids = allIds.slice(i, i + 50).join(",");
    const cres = await fetch(`${API}/channels?part=snippet,statistics&id=${ids}&key=${key}`).catch(() => null);
    if (!cres || !cres.ok) continue;
    const cdata = (await cres.json().catch(() => ({}))) as {
      items?: { id?: string; snippet?: { title?: string; description?: string; customUrl?: string }; statistics?: { subscriberCount?: string; videoCount?: string } }[];
    };
    for (const ch of cdata.items ?? []) {
      scanned++;
      const desc = ch.snippet?.description ?? "";
      const email = extractEmail(desc);
      const link = extractUrl(desc, LINK_RE);
      if (!email && !link) continue; // need something actionable (email now, or a link to enrich later)
      const subs = parseInt(ch.statistics?.subscriberCount ?? "0", 10) || 0;
      const videos = parseInt(ch.statistics?.videoCount ?? "0", 10) || 0;
      const pub = chanPub.get(ch.id ?? "") ?? "";
      const releaseDays = pub ? Math.floor((now - Date.parse(pub)) / 86400000) : null;
      const heat = computeHeat({ releaseDays, hasIntent: false, followers: subs, hasEmail: !!email });
      const wrote = await upsertRadarLead({
        source: "youtube",
        handle: ch.id ?? ch.snippet?.customUrl ?? ch.snippet?.title ?? "",
        name: ch.snippet?.title ?? null,
        spotify_url: extractUrl(desc, "open\\.spotify\\.com|spotify\\.link"),
        soundcloud_url: extractUrl(desc, "soundcloud\\.com"),
        email,
        email_source: email ? "yt_channel" : null,
        followers: subs,
        video_count: videos,
        release_date: pub ? pub.slice(0, 10) : null,
        intent_signal: `${subs.toLocaleString()} subs · ${videos.toLocaleString()} videos`,
        source_url: ch.snippet?.customUrl ? `https://youtube.com/${ch.snippet.customUrl}` : (ch.id ? `https://youtube.com/channel/${ch.id}` : null),
        heat_score: heat,
      }).catch(() => 0);
      if (wrote) { hot++; if (email) withEmail++; }
    }
  }
  return NextResponse.json({ ok: true, searched, queries, scanned, hot, withEmail, ts: new Date().toISOString() });
}
