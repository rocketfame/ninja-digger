/**
 * Graph discovery run. Walks outward from producers we already know, and tops
 * the frontier up from the current upload feed so the crawl keeps meeting
 * artists who are active today rather than drifting into whoever was big years
 * ago.
 *
 * Separate from /api/cron/soundcloud on purpose: that one works a fixed seed
 * list of Re-Ex advertisers and their followers, which exhausts. This one has
 * no seed list — every producer it finds is a new expansion point.
 */
import { NextResponse } from "next/server";
import { crawlFollowings, seedFromRecentUploads } from "@/lib/soundcloudDiscover";
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Genres we actually sell into. Rotated so each run tops up a different slice. */
const GENRES = [
  "techno", "house", "deep house", "melodic techno", "afro house", "tech house",
  "drum and bass", "dubstep", "trap", "hip hop", "psytrance", "hardstyle",
  "progressive house", "minimal", "electronica", "future bass", "lofi hip hop", "garage",
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await acquireLease("sc-crawl", 6))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  const t0 = Date.now();
  // Seed first and cheaply: two genres a run covers the whole list twice a day
  // at a nine-minute cadence, and gives the graph fresh, currently-active entry
  // points before it spends the rest of the budget expanding.
  const slice = (Math.floor(Date.now() / 540_000) * 2) % GENRES.length;
  const seeded = await seedFromRecentUploads(GENRES.slice(slice, slice + 2)).catch(() => ({ discovered: 0, withEmail: 0 }));

  const crawled = await crawlFollowings({ users: 40, budgetMs: 300_000 - (Date.now() - t0) - 20_000 })
    .catch(() => ({ expanded: 0, discovered: 0, withEmail: 0, exhausted: false }));

  return NextResponse.json({
    ok: true,
    seeded,
    crawled,
    genres: GENRES.slice(slice, slice + 2),
    tookMs: Date.now() - t0,
    ts: new Date().toISOString(),
  });
}
