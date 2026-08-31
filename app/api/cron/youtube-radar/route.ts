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

// YouTube is enormous, so the whole game is QUERY DIVERSITY — hitting the long
// tail of small producers/artists instead of re-scanning the same popular
// channels. We build a big matrix of genres × angles and rotate deeply so every
// run explores a fresh slice.
const GENRES = [
  "trap", "drill", "uk drill", "jersey club", "phonk", "hyperpop", "plugg", "rage",
  "boom bap", "lofi", "lofi hip hop", "rnb", "soul", "afrobeat", "afro house",
  "amapiano", "reggaeton", "dancehall", "baile funk", "gqom", "house", "deep house",
  "tech house", "melodic techno", "techno", "minimal techno", "dnb", "drum and bass",
  "garage", "uk garage", "dubstep", "future bass", "synthwave", "hardstyle",
  "hardcore", "ambient", "downtempo", "jazz", "neo soul", "hip hop", "indie pop",
  "bedroom pop", "shoegaze", "dream pop", "trance", "psytrance", "breakbeat",
  "electro", "grime", "hyperpop", "emo rap", "cloud rap", "trap soul", "kpop",
  "latin trap", "corridos", "sertanejo", "k-pop", "j-pop",
];
// Angle applied to each genre. "type beat" is the email-goldmine (producers put
// a lease/booking email in every description).
const ANGLES = ["type beat", "type beat 2026", "premiere", "new 2026", "out now"];
// Genre-independent indie phrases (fresh releases with contact links).
const GENERIC = [
  "free type beat", "prod by", "demo submission", "unsigned artist",
  "independent artist new single", "official music video 2026", "new EP out now",
  "out now spotify", "self released", "unreleased music", "beat store",
];
// Flatten genre × angle + generics into one big pool (~300 unique queries).
const POOL: string[] = [
  ...GENRES.flatMap((g) => ANGLES.map((a) => `${g} ${a}`)),
  ...GENERIC,
];

/** Rotate deeply through POOL by absolute hour so consecutive runs never repeat
 * and the whole space is swept over time; force one email-rich "type beat"
 * query per run. */
function pickQueries(runIdx: number): string[] {
  return [
    `${GENRES[runIdx % GENRES.length]} type beat`,        // email-rich producer niche
    POOL[(runIdx * 2) % POOL.length],
    POOL[(runIdx * 2 + 7) % POOL.length],                  // +7 stride → different slice
  ];
}
const LINK_RE = "open\\.spotify\\.com|spotify\\.link|soundcloud\\.com|linktr\\.ee|beacons\\.ai|bandcamp\\.com|band\\.link|hypeddit\\.com";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ ok: true, skipped: "no YOUTUBE_API_KEY" });

  // Absolute-hour index → deep rotation through the big query pool (see above),
  // so each run explores a fresh slice of the long tail.
  const runIdx = Math.floor(Date.now() / 3600000);
  const queries = pickQueries(runIdx).slice(0, SEARCHES_PER_RUN);
  // Vary the freshness window too, so we reach recent AND slightly older but
  // still-active channels instead of the same newest uploads every time.
  const windowDays = [30, 90, 14, 60][runIdx % 4];
  const publishedAfter = new Date(Date.now() - windowDays * 86400000).toISOString();

  // 1) Search each query → collect unique channelIds (+ upload date) and the
  //    video ids so we can read the full per-video descriptions next.
  const chanPub = new Map<string, string>();
  const videoToChan = new Map<string, string>();
  let searched = 0;
  for (const q of queries) {
    const url = `${API}/search?part=snippet&type=video&videoCategoryId=10&order=date&maxResults=${RESULTS_PER_SEARCH}&q=${encodeURIComponent(q)}&publishedAfter=${publishedAfter}&key=${key}`;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) continue; // one query failing (e.g. transient) must not kill the run
    searched++;
    const data = (await res.json().catch(() => ({}))) as { items?: { id?: { videoId?: string }; snippet?: { channelId?: string; publishedAt?: string } }[] };
    for (const it of data.items ?? []) {
      const cid = it.snippet?.channelId;
      if (cid && !chanPub.has(cid)) chanPub.set(cid, it.snippet?.publishedAt ?? "");
      const vid = it.id?.videoId;
      if (vid && cid) videoToChan.set(vid, cid);
    }
  }
  if (chanPub.size === 0) return NextResponse.json({ ok: true, searched, scanned: 0, hot: 0 });

  // 1b) Full video descriptions (videos.list ≈ 3 units/batch) — indie artists &
  //     producers put a booking/lease email in the VIDEO description far more
  //     often than in the channel "about". Accumulate per channel as a fallback.
  const chanVideoText = new Map<string, string>();
  const vids = [...videoToChan.keys()];
  for (let i = 0; i < vids.length; i += 50) {
    const ids = vids.slice(i, i + 50).join(",");
    const vres = await fetch(`${API}/videos?part=snippet&id=${ids}&key=${key}`).catch(() => null);
    if (!vres || !vres.ok) continue;
    const vdata = (await vres.json().catch(() => ({}))) as { items?: { id?: string; snippet?: { description?: string } }[] };
    for (const v of vdata.items ?? []) {
      const cid = videoToChan.get(v.id ?? "");
      const desc = v.snippet?.description ?? "";
      if (cid && desc) chanVideoText.set(cid, (chanVideoText.get(cid) ?? "") + "\n" + desc);
    }
  }

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
      // Search email/links across BOTH the channel "about" and the video
      // descriptions we pulled — video descriptions carry booking emails far
      // more often.
      const chanDesc = ch.snippet?.description ?? "";
      const vidDesc = chanVideoText.get(ch.id ?? "") ?? "";
      const text = chanDesc + "\n" + vidDesc;
      const email = extractEmail(text);
      const link = extractUrl(text, LINK_RE);
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
        spotify_url: extractUrl(text, "open\\.spotify\\.com|spotify\\.link"),
        soundcloud_url: extractUrl(text, "soundcloud\\.com"),
        website: extractUrl(text, "linktr\\.ee|beacons\\.ai|band\\.link|hypeddit\\.com|bandcamp\\.com"),
        email,
        email_source: email ? (extractEmail(chanDesc) ? "yt_channel" : "yt_video") : null,
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
