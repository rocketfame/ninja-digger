/**
 * GET /api/cron/soundcloud — harvest followers of active seed accounts.
 * Resumable: each run continues from the stored cursor.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { harvestSeedFollowers, verifyActiveArtists } from "@/lib/soundcloud";
import { enrichScBatch } from "@/lib/soundcloudEnrich";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const seeds = await pool.query<{ permalink: string }>(
    `SELECT permalink FROM sc_seed_accounts WHERE active = true
     ORDER BY last_harvested_at ASC NULLS FIRST LIMIT 1`
  );
  if (seeds.rows.length === 0) return NextResponse.json({ ok: true, message: "no active seeds" });

  const results = [];
  for (const s of seeds.rows) {
    const r = await harvestSeedFollowers(s.permalink, 4);
    results.push({ seed: s.permalink, ...r });
  }
  // Deep-verify a slice of tier-A gems each run (latest-track check)
  const verified = await verifyActiveArtists(50);
  // Enrich email-less A/B/promoter artists via their public funnel — bigger
  // batch so the gold gets contacts steadily, not a trickle
  const enriched = await enrichScBatch(25);
  return NextResponse.json({ ok: true, results, verified, enriched, ts: new Date().toISOString() });
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
