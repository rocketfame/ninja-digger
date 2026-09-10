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
import { getSetting } from "@/lib/settings";

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

  // Expansion rate is a runtime knob, not a constant: the base grew 19 MB an
  // hour on the first afternoon, which reaches the 512 MB tier in a working
  // day, and a full database halts EVERY engine (it did once). Until the tier
  // is raised this runs at a fraction; afterwards it goes back up without a
  // deploy. app_settings.sc_crawl_users_per_run, default 40.
  const perRun = parseInt(await getSetting("sc_crawl_users_per_run", "40"), 10) || 40;
  const crawled = await crawlFollowings({ users: perRun, budgetMs: 300_000 - (Date.now() - t0) - 20_000 })
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
