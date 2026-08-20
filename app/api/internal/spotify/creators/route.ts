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

/**
 * Score a creator as a lead SOURCE. The DOMINANT factor is the comment-collection
 * mechanic — how many comments their posts pull + whether captions farm comments
 * ("comment X", "drop your link"). Bio/followers are secondary hints. A great
 * source can have a bland bio but posts drowning in artist comments.
 */
function scoreCreator(o: { bio: string; category: string | null; followers: number | null; avgComments?: number | null; mechanicHits?: number | null }): number {
  let s = 0;
  // 1) Comment-mechanic — the real trigger (up to ~70)
  const avg = o.avgComments ?? 0;
  if (avg >= 300) s += 45; else if (avg >= 100) s += 35; else if (avg >= 40) s += 22; else if (avg >= 15) s += 10;
  const hits = o.mechanicHits ?? 0;
  if (hits >= 3) s += 25; else if (hits >= 1) s += 12;
  // 2) Bio relevance — secondary hint (up to ~20)
  const text = `${o.bio} ${o.category ?? ""}`;
  if (STRONG.test(text)) s += 15; else if (MED.test(text)) s += 5;
  // 3) Follower sweet spot (up to 10)
  const f = o.followers ?? 0;
  if (f >= 2000 && f <= 500000) s += 10; else if (f > 500000) s += 3;
  return s;
}

type Item = { username?: string; id?: string; full_name?: string; followers?: number; bio?: string; category?: string; discovered_from?: string; avgComments?: number; mechanicHits?: number; sampledPosts?: number; isReelHeavy?: boolean };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no items" }, { status: 400, headers: CORS });

  let upserted = 0;
  for (const it of items) {
    const username = String(it.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) continue;
    const score = scoreCreator({ bio: it.bio ?? "", category: it.category ?? null, followers: it.followers ?? null, avgComments: it.avgComments, mechanicHits: it.mechanicHits });
    const res = await pool.query(
      `INSERT INTO spotify_creators (ig_username, ig_id, full_name, followers, bio, category, score, discovered_from, avg_comments, mechanic_hits, sampled_posts, is_reel_heavy, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'candidate')
       ON CONFLICT (ig_username) DO UPDATE SET
         ig_id = COALESCE(spotify_creators.ig_id, EXCLUDED.ig_id),
         full_name = COALESCE(EXCLUDED.full_name, spotify_creators.full_name),
         followers = COALESCE(EXCLUDED.followers, spotify_creators.followers),
         bio = COALESCE(EXCLUDED.bio, spotify_creators.bio),
         category = COALESCE(EXCLUDED.category, spotify_creators.category),
         avg_comments = COALESCE(EXCLUDED.avg_comments, spotify_creators.avg_comments),
         mechanic_hits = COALESCE(EXCLUDED.mechanic_hits, spotify_creators.mechanic_hits),
         sampled_posts = COALESCE(EXCLUDED.sampled_posts, spotify_creators.sampled_posts),
         is_reel_heavy = COALESCE(EXCLUDED.is_reel_heavy, spotify_creators.is_reel_heavy),
         score = GREATEST(spotify_creators.score, EXCLUDED.score),
         updated_at = now()
       WHERE spotify_creators.status = 'candidate'`,
      [username, it.id ?? null, it.full_name ?? null, it.followers ?? null, (it.bio ?? "").slice(0, 600) || null, it.category ?? null, score, it.discovered_from ?? null, it.avgComments ?? null, it.mechanicHits ?? null, it.sampledPosts ?? null, it.isReelHeavy ?? null]
    ).catch(() => ({ rowCount: 0 }));
    upserted += res.rowCount ?? 0;
  }
  const stats = (await pool.query<{ total: number; cand: number }>(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='candidate')::int cand FROM spotify_creators`
  )).rows[0];
  return NextResponse.json({ ok: true, received: items.length, upserted, stats }, { headers: CORS });
}
