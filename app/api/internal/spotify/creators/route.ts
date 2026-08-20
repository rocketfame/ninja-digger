/**
 * POST /api/internal/spotify/creators — upsert discovered creator candidates
 * (from IG discover/chaining + info, harvested in a browser session). Scores
 * each by how good a lead-SOURCE it looks: promo/curator/marketing bios and a
 * healthy follower range rank high; plain artist accounts rank low.
 * Body: { items: [{ username, id?, full_name?, followers?, bio?, category?, discovered_from? }] }
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
export function OPTIONS() { return new NextResponse(null, { headers: CORS }); }

// Signals that an account is a promo/curator/marketing hub (a good lead source),
// not just an artist. Higher weight = stronger source signal.
const STRONG = /(promo|playlist|curator|submit (your|music)|music marketing|grow your|grow on|spotify growth|a&r|record label|feature your|get your music|music promotion|distribut|independent artists?|music network|exposure|get heard|upload your music|go viral|help (musicians|artists|music)|more streams|get more|pitch your|get signed|music career|scouting|monetiz|sync licensing)/i;
const MED = /(marketing|producer|mixing|mastering|beats|music biz|artist development|management|records|studio|\bdj\b|songwriter|blog|network|viral|billboard|platinum|coach|mentor)/i;

// Niche signals. Target = MUSIC promotion (Spotify/streams/exposure/fans). The
// trap is VIDEO-content promo: rapvilleuk farms comments but sells viral VIDEO /
// content shoots (commenters are content creators, not artists chasing streams).
// The discriminator is music-promo vs video-content — not Spotify-only.
const MUSIC_PROMO = /spotify|playlist|stream(s|ing)?|apple music|deezer|tidal|exposure|help (musicians|artists|music)|get more (fans|streams|listeners|exposure|plays)|music promotion|music marketing|grow your (music|streams|spotify|audience|fanbase|fans)|submit your music|get (your )?music (heard|out|on)|get heard|get discovered|distribut|record (deal|label)|\ba&r\b|pitch your (song|music|track)|get playlisted|more (streams|listeners|fans)/i;
const CONTENT = /viral (production|video|content|reel|clip)|content (shoot|creator|creation|strateg|ideas)|videograph|filmmaker|cinematograph|book (your|a) (shoot|content|next|session)|shoot with us|video (production|shoot|editing|team)|social media (manager|content|growth)|grow on (instagram|ig|tiktok|social)|reels? (strateg|tips|growth)|instagram growth|\bphotograph|\bfilm\b/i;
const PRODUCER = /fl studio|ableton|logic pro|mixing|mastering|\bplugin|sample pack|preset|beat (tutorial|tips)|how to produce|music production tutorial|sound design|one knob|drum (sample|kit)/i;

/** Classify a creator's niche. Music-promo is the target; video-content, producer
 *  education and IG-growth are off-target even when they farm comments. */
function classifyNiche(text: string, promoHits: number, contentHits: number): string {
  const music = MUSIC_PROMO.test(text);
  const content = CONTENT.test(text);
  const producer = PRODUCER.test(text);
  // Unambiguous video-content signals win — unless music-promo clearly dominates.
  if (content && (!music || contentHits > promoHits)) return content && /grow on (instagram|ig)|instagram growth/.test(text) ? "ig_growth" : "viral_video";
  if (music || promoHits >= 1) return "spotify_promo";
  if (producer) return "producer_edu";
  if (contentHits > 0) return "viral_video";
  return "other";
}

/**
 * Score a creator as a Spotify/streaming-promo lead SOURCE. Requires BOTH the
 * comment-collection mechanic AND the correct NICHE (spotify_promo). Off-niche
 * (viral video, producer education, IG growth) is capped low no matter how many
 * comments — its commenters aren't artists chasing streams.
 */
function scoreCreator(o: { bio: string; category: string | null; followers: number | null; avgComments?: number | null; mechanicHits?: number | null; promoHits?: number | null; contentHits?: number | null }): { score: number; niche: string } {
  const text = `${o.bio} ${o.category ?? ""}`;
  const promoHits = o.promoHits ?? 0;
  const contentHits = o.contentHits ?? 0;
  const niche = classifyNiche(text, promoHits, contentHits);

  let s = 0;
  const avg = o.avgComments ?? 0;
  if (avg >= 300) s += 45; else if (avg >= 100) s += 35; else if (avg >= 40) s += 22; else if (avg >= 15) s += 10;
  const hits = o.mechanicHits ?? 0;
  if (hits >= 3) s += 25; else if (hits >= 1) s += 12;
  if (MUSIC_PROMO.test(text)) s += 15;
  if (promoHits >= 3) s += 20; else if (promoHits >= 1) s += 10;
  const f = o.followers ?? 0;
  if (f >= 2000 && f <= 500000) s += 8;

  // GATE: only the Spotify/streaming-promo niche scores high.
  if (niche !== "spotify_promo") s = Math.min(s, 20);
  return { score: s, niche };
}

type Item = { username?: string; id?: string; full_name?: string; followers?: number; bio?: string; category?: string; discovered_from?: string; avgComments?: number; mechanicHits?: number; promoHits?: number; contentHits?: number; sampledPosts?: number; isReelHeavy?: boolean };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no items" }, { status: 400, headers: CORS });

  let upserted = 0;
  for (const it of items) {
    const username = String(it.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) continue;
    const { score, niche } = scoreCreator({ bio: it.bio ?? "", category: it.category ?? null, followers: it.followers ?? null, avgComments: it.avgComments, mechanicHits: it.mechanicHits, promoHits: it.promoHits, contentHits: it.contentHits });
    const res = await pool.query(
      `INSERT INTO spotify_creators (ig_username, ig_id, full_name, followers, bio, category, score, niche, discovered_from, avg_comments, mechanic_hits, promo_hits, content_hits, sampled_posts, is_reel_heavy, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'candidate')
       ON CONFLICT (ig_username) DO UPDATE SET
         ig_id = COALESCE(spotify_creators.ig_id, EXCLUDED.ig_id),
         full_name = COALESCE(EXCLUDED.full_name, spotify_creators.full_name),
         followers = COALESCE(EXCLUDED.followers, spotify_creators.followers),
         bio = COALESCE(EXCLUDED.bio, spotify_creators.bio),
         category = COALESCE(EXCLUDED.category, spotify_creators.category),
         avg_comments = COALESCE(EXCLUDED.avg_comments, spotify_creators.avg_comments),
         mechanic_hits = COALESCE(EXCLUDED.mechanic_hits, spotify_creators.mechanic_hits),
         promo_hits = COALESCE(EXCLUDED.promo_hits, spotify_creators.promo_hits),
         content_hits = COALESCE(EXCLUDED.content_hits, spotify_creators.content_hits),
         sampled_posts = COALESCE(EXCLUDED.sampled_posts, spotify_creators.sampled_posts),
         is_reel_heavy = COALESCE(EXCLUDED.is_reel_heavy, spotify_creators.is_reel_heavy),
         niche = EXCLUDED.niche,
         score = EXCLUDED.score,
         updated_at = now()
       WHERE spotify_creators.status = 'candidate'`,
      [username, it.id ?? null, it.full_name ?? null, it.followers ?? null, (it.bio ?? "").slice(0, 600) || null, it.category ?? null, score, niche, it.discovered_from ?? null, it.avgComments ?? null, it.mechanicHits ?? null, it.promoHits ?? null, it.contentHits ?? null, it.sampledPosts ?? null, it.isReelHeavy ?? null]
    ).catch(() => ({ rowCount: 0 }));
    upserted += res.rowCount ?? 0;
  }
  const stats = (await pool.query<{ total: number; cand: number }>(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='candidate')::int cand FROM spotify_creators`
  )).rows[0];
  return NextResponse.json({ ok: true, received: items.length, upserted, stats }, { headers: CORS });
}
