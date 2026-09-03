/**
 * POST /api/internal/soundcloud/ingest-campaigns
 * Receives RepostExchange campaign submitters (harvested from the logged-in
 * browser session) and upserts them as high-intent SoundCloud leads.
 * CORS-open so the repostexchange.com page can POST directly.
 */
import { NextResponse } from "next/server";
import { pickBestEmail } from "@/lib/emailJunk";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}


type Submitter = {
  ExternalId?: number; Name?: string; Permalink?: string; PermalinkUrl?: string; AvatarUrl?: string;
  Genres?: string[]; Followers?: number; Created?: string; ReputationScore?: number;
  InstagramHandle?: string; FacebookHandle?: string; TwitterHandle?: string;
  YouTubeHandle?: string; SpotifyHandle?: string; TikTokHandle?: string;
  Description?: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Submitter[] = Array.isArray(body.submitters) ? body.submitters : [];
  const totalActive = Number(body.totalActive) || 0;
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no submitters" }, { status: 400, headers: CORS });

  let upserted = 0;
  for (const s of items) {
    if (!s.ExternalId || !s.Name) continue;
    const email = pickBestEmail(s.Description ?? "");
    const res = await pool.query(
      `INSERT INTO sc_artists (soundcloud_id, permalink, permalink_url, username, full_name, avatar_url,
          followers_count, sc_created_at, genres, reputation, is_promoter, source_seed,
          instagram, facebook, twitter, youtube, spotify, tiktok, email, email_source, tier, is_active, harvested_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'repostexchange',$11,$12,$13,$14,$15,$16,$17,$18,'A',true,now(),now())
       ON CONFLICT (soundcloud_id) DO UPDATE SET
         followers_count=$7, genres=$9, reputation=$10, is_promoter=true,
         instagram=COALESCE(EXCLUDED.instagram, sc_artists.instagram),
         facebook=COALESCE(EXCLUDED.facebook, sc_artists.facebook),
         twitter=COALESCE(EXCLUDED.twitter, sc_artists.twitter),
         youtube=COALESCE(EXCLUDED.youtube, sc_artists.youtube),
         spotify=COALESCE(EXCLUDED.spotify, sc_artists.spotify),
         tiktok=COALESCE(EXCLUDED.tiktok, sc_artists.tiktok),
         email=COALESCE(sc_artists.email, EXCLUDED.email),
         tier='A', is_active=true, updated_at=now()`,
      [s.ExternalId, s.Permalink ?? null, s.PermalinkUrl ?? null, s.Name, s.Name, s.AvatarUrl ?? null,
       s.Followers ?? 0, s.Created ?? null, s.Genres ?? null, s.ReputationScore ?? null,
       s.InstagramHandle ?? null, s.FacebookHandle ?? null, s.TwitterHandle ?? null,
       s.YouTubeHandle ?? null, s.SpotifyHandle ?? null, s.TikTokHandle ?? null,
       email, email ? "bio" : null]
    );
    upserted += res.rowCount ?? 0;

    // A campaign-runner is an active promo channel — seed it so we harvest its
    // followers (self-promoting artists) with our own SoundCloud tools. Follower
    // cap protects the 512MB tier from a single mega-channel.
    const followers = s.Followers ?? 0;
    if (s.Permalink && followers >= 30 && followers <= 50000) {
      // priority 2 = Re-Ex advertiser (highest-intent) — harvested before anything.
      await pool.query(
        `INSERT INTO sc_seed_accounts (permalink, soundcloud_id, username, followers_count, active, priority)
         VALUES ($1,$2,$3,$4,true,2) ON CONFLICT (permalink) DO NOTHING`,
        [s.Permalink, s.ExternalId, s.Name, followers]
      ).catch(() => {});
    }
  }
  // Daily market-pulse snapshot (active campaigns today)
  if (totalActive > 0) {
    await pool.query(
      `INSERT INTO reex_daily (day, active_campaigns, submitters_ingested, captured_at)
       VALUES (CURRENT_DATE, $1, $2, now())
       ON CONFLICT (day) DO UPDATE SET active_campaigns = GREATEST(reex_daily.active_campaigns, $1),
         submitters_ingested = reex_daily.submitters_ingested + $2, captured_at = now()`,
      [totalActive, items.length]
    ).catch(() => {});
  }
  return NextResponse.json({ ok: true, upserted, received: items.length, totalActive }, { headers: CORS });
}
