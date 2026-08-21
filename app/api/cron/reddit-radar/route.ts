/**
 * GET /api/cron/reddit-radar — Reddit "hot lead" discovery.
 * Pulls newest self-promo posts from music-promo subreddits (artists posting a
 * fresh release + asking for promo = peak intent), keeps those with a Spotify
 * link, extracts email, scores heat, upserts into radar_leads (source='reddit').
 *
 * Reddit blocks anonymous datacenter scraping (403), so this uses application-
 * only OAuth. No-ops until REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set.
 */
import { NextResponse } from "next/server";
import { extractEmail, extractUrl, computeHeat, upsertRadarLead } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Self-promo subs where artists post a fresh release seeking exposure.
const SUBS = ["musicpromotion", "thisismylabel", "shareyourmusic", "SpotifyPlaylists", "playlists", "spotify"];
const UA = "web:ninja-digger:v1 (by /u/ninjadigger)";

async function getToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "grant_type=client_credentials",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { access_token?: string };
  return j.access_token ?? null;
}

type Post = { author?: string; title?: string; selftext?: string; url?: string; created_utc?: number; permalink?: string; subreddit?: string };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getToken();
  if (!token) return NextResponse.json({ ok: true, skipped: "no REDDIT_CLIENT_ID/SECRET" });

  const now = Date.now();
  let scanned = 0, hot = 0, withEmail = 0;

  for (const sub of SUBS) {
    const res = await fetch(`https://oauth.reddit.com/r/${sub}/new?limit=50`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
    }).catch(() => null);
    if (!res || !res.ok) continue;
    const data = (await res.json().catch(() => ({}))) as { data?: { children?: { data: Post }[] } };
    const posts = (data.data?.children ?? []).map((c) => c.data);
    for (const p of posts) {
      scanned++;
      const blob = `${p.title ?? ""}\n${p.selftext ?? ""}\n${p.url ?? ""}`;
      const spotify = extractUrl(blob, "open\\.spotify\\.com|spotify\\.link");
      if (!spotify) continue; // must be a Spotify artist — our target
      const email = extractEmail(blob);
      const releaseDays = p.created_utc ? Math.floor((now / 1000 - p.created_utc) / 86400) : null;
      const heat = computeHeat({ releaseDays, hasIntent: true, followers: null, hasEmail: !!email });
      const handle = p.author ? `u/${p.author}` : (spotify.match(/(artist|track)\/([A-Za-z0-9]+)/)?.[2] ?? spotify);
      const wrote = await upsertRadarLead({
        source: "reddit",
        handle,
        name: p.author ?? null,
        spotify_url: spotify,
        soundcloud_url: extractUrl(blob, "soundcloud\\.com"),
        email,
        email_source: email ? "reddit_post" : null,
        release_date: p.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : null,
        intent_signal: (p.title ?? "").slice(0, 200),
        source_url: p.permalink ? `https://reddit.com${p.permalink}` : null,
        heat_score: heat,
      }).catch(() => 0);
      if (wrote) { hot++; if (email) withEmail++; }
    }
  }
  return NextResponse.json({ ok: true, scanned, hot, withEmail, ts: new Date().toISOString() });
}
