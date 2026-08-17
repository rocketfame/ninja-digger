/**
 * SoundCloud seed promotion.
 * RepostExchange gives us accounts that RUN promo campaigns — active, paying,
 * real promo channels. Their followers are self-promoting artists = our leads.
 * So we promote each promoter into sc_seed_accounts and let the harvest cron
 * parse their followers with our own SoundCloud tools.
 *
 * GET  — status: DB size + counts (dry-run, safe to poll).
 * POST — backfill: promote existing promoters (with a follower cap so one
 *        mega-channel can't flood the 512MB Neon tier) into seeds.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Only seed promoters within a sane follower band: big enough to have real
// artist followers, small enough not to blow the DB when harvested.
const MIN_FOLLOWERS = 30;
const MAX_FOLLOWERS = 50000;

async function stats() {
  const [size, arts, seeds] = await Promise.all([
    pool.query<{ mb: number }>(`SELECT (pg_database_size(current_database())/1048576.0)::numeric(10,1) AS mb`),
    pool.query<{ total: number; promoters: number; eligible: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_promoter)::int AS promoters,
              COUNT(*) FILTER (WHERE is_promoter AND permalink IS NOT NULL
                AND followers_count BETWEEN $1 AND $2)::int AS eligible
       FROM sc_artists`, [MIN_FOLLOWERS, MAX_FOLLOWERS]),
    pool.query<{ total: number; harvested: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE last_harvested_at IS NOT NULL)::int AS harvested
       FROM sc_seed_accounts`),
  ]);
  return {
    dbSizeMB: Number(size.rows[0].mb),
    scArtists: arts.rows[0].total,
    promoters: arts.rows[0].promoters,
    eligiblePromoterSeeds: arts.rows[0].eligible,
    seeds: seeds.rows[0].total,
    seedsHarvested: seeds.rows[0].harvested,
  };
}

export async function GET() {
  return NextResponse.json({ ok: true, ...(await stats()) });
}

export async function POST() {
  // Promote every eligible promoter into a seed. ON CONFLICT keeps existing
  // cursors intact so we never restart a seed's pagination.
  const res = await pool.query(
    `INSERT INTO sc_seed_accounts (permalink, soundcloud_id, username, followers_count, active)
     SELECT permalink, soundcloud_id, COALESCE(username, full_name, permalink), followers_count, true
     FROM sc_artists
     WHERE is_promoter = true AND permalink IS NOT NULL
       AND followers_count BETWEEN $1 AND $2
     ON CONFLICT (permalink) DO NOTHING`,
    [MIN_FOLLOWERS, MAX_FOLLOWERS]
  );
  return NextResponse.json({ ok: true, added: res.rowCount ?? 0, ...(await stats()) });
}
