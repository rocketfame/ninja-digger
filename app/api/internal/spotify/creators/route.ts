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

function scoreCreator(bio: string, category: string | null, followers: number | null): number {
  let s = 0;
  const text = `${bio} ${category ?? ""}`;
  if (STRONG.test(text)) s += 50;
  if (MED.test(text)) s += 20;
  const f = followers ?? 0;
  if (f >= 1000 && f <= 500000) s += 20;      // active promo range
  else if (f > 500000) s += 5;                 // huge = maybe not niche-promo
  if (category) s += 5;                        // business account
  return s;
}

type Item = { username?: string; id?: string; full_name?: string; followers?: number; bio?: string; category?: string; discovered_from?: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no items" }, { status: 400, headers: CORS });

  let upserted = 0;
  for (const it of items) {
    const username = String(it.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) continue;
    const score = scoreCreator(it.bio ?? "", it.category ?? null, it.followers ?? null);
    const res = await pool.query(
      `INSERT INTO spotify_creators (ig_username, ig_id, full_name, followers, bio, category, score, discovered_from, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'candidate')
       ON CONFLICT (ig_username) DO UPDATE SET
         ig_id = COALESCE(spotify_creators.ig_id, EXCLUDED.ig_id),
         full_name = COALESCE(EXCLUDED.full_name, spotify_creators.full_name),
         followers = COALESCE(EXCLUDED.followers, spotify_creators.followers),
         bio = COALESCE(EXCLUDED.bio, spotify_creators.bio),
         category = COALESCE(EXCLUDED.category, spotify_creators.category),
         score = GREATEST(spotify_creators.score, EXCLUDED.score),
         updated_at = now()
       WHERE spotify_creators.status = 'candidate'`,
      [username, it.id ?? null, it.full_name ?? null, it.followers ?? null, (it.bio ?? "").slice(0, 600) || null, it.category ?? null, score, it.discovered_from ?? null]
    ).catch(() => ({ rowCount: 0 }));
    upserted += res.rowCount ?? 0;
  }
  const stats = (await pool.query<{ total: number; cand: number }>(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='candidate')::int cand FROM spotify_creators`
  )).rows[0];
  return NextResponse.json({ ok: true, received: items.length, upserted, stats }, { headers: CORS });
}
