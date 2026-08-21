/**
 * GET /api/cron/sc-enrich — dedicated SoundCloud email enrichment.
 * SPLIT OUT of the tight 120s harvest cron (which could only afford 4/run) so
 * enrichment gets its own 300s budget and real concurrency. This is what
 * actually drains the ~25k tier-A/B/promoter backlog into emails instead of
 * ~192/day. Pure enrichment — only updates existing rows, never adds (safe for
 * the 512MB Neon cap).
 */
import { NextResponse } from "next/server";
import { enrichScBatch } from "@/lib/soundcloudEnrich";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 30;
const CONCURRENCY = 6;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const { processed, found } = await enrichScBatch(PER_RUN, CONCURRENCY);

  // Backlog visibility so throughput is measurable from the response/logs.
  const remaining = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM sc_artists
     WHERE email IS NULL AND (is_promoter = true OR tier IN ('A','B'))`
  ).then((r) => r.rows[0]?.c ?? -1).catch(() => -1);

  return NextResponse.json({
    ok: true,
    processed,
    found,
    remaining,
    ms: Date.now() - t0,
    ts: new Date().toISOString(),
  });
}
