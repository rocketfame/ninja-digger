/**
 * GET /api/cron/soundcloud — harvest followers of active seed accounts.
 * Resumable: each run continues from the stored cursor.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { harvestSeedFollowers, verifyActiveArtists, refreshPromoterProfiles } from "@/lib/soundcloud";
import { enrichScBatch } from "@/lib/soundcloudEnrich";
import { defendDbSpace } from "@/lib/dbGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Self-defense first: auto-reclaim space + Telegram alert if near the limit.
  const guard = await defendDbSpace();

  // Overflow guard: the Neon free tier caps at 512MB and a full DB once killed
  // ingestion. Above the safe line we stop adding rows (harvest) but still run
  // enrich/verify, which only update existing rows.
  const SAFE_MB = 460;
  const dbMb = guard.after;
  const harvestOk = dbMb < SAFE_MB;

  // Rotate through the least-recently-harvested seeds. 773+ promoter channels
  // now seed the pipeline, so we take a few per run (2 pages each) to spread
  // coverage without exhausting any single one or flooding the DB.
  // Uncompleted seeds first (deep-harvest their newest 600 followers), then
  // seeds completed >14 days ago for a light refresh of new followers only.
  const seeds = harvestOk
    ? await pool.query<{ permalink: string }>(
        `SELECT permalink FROM sc_seed_accounts
         WHERE active = true AND (completed_at IS NULL OR completed_at < now() - interval '14 days')
         ORDER BY completed_at NULLS FIRST, last_harvested_at ASC NULLS FIRST LIMIT 6`)
    : { rows: [] as { permalink: string }[] };

  // Harvest FIRST and take the bigger share of the time budget — it's the only
  // step that adds new leads. verify/enrich only groom existing rows, so keep
  // them lean so a run never starves harvest or times out.
  const results = [];
  for (const s of seeds.rows) {
    const r = await harvestSeedFollowers(s.permalink, 2);
    results.push({ seed: s.permalink, ...r });
  }
  // Deep-verify a slice of tier-A gems each run (latest-track check)
  const verified = await verifyActiveArtists(15);
  // Fill in real track_count for Re-Ex promoters so repost channels (analytics)
  // separate from real artists (outreach leads).
  const promoterProfiles = await refreshPromoterProfiles(8);
  // Enrich email-less A/B/promoter artists via their public funnel.
  const enriched = await enrichScBatch(12);
  // Dynamic bloat control: keep the regenerable HTML cache tightly bounded so it
  // never balloons between daily truncates (it was the #1 space hog at 172MB).
  await pool.query("DELETE FROM url_cache WHERE fetched_at < now() - interval '6 hours'").catch(() => {});
  return NextResponse.json({ ok: true, dbMb, harvestOk, guard, results, verified, promoterProfiles, enriched, ts: new Date().toISOString() });
}

// Manual trigger with a bigger page budget (POST from the /sc-leads button)
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const permalink = searchParams.get("seed") ?? undefined;
  const pages = Math.min(parseInt(searchParams.get("pages") ?? "6", 10) || 6, 10);
  const seed = permalink ?? (await pool.query<{ permalink: string }>(
    `SELECT permalink FROM sc_seed_accounts WHERE active=true ORDER BY last_harvested_at ASC NULLS FIRST LIMIT 1`
  ).then((r) => r.rows[0]?.permalink));
  if (!seed) return NextResponse.json({ ok: false, error: "no seed" }, { status: 400 });
  const r = await harvestSeedFollowers(seed, pages);
  return NextResponse.json({ ok: true, seed, ...r });
}
