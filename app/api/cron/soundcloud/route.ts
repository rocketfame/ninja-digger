/**
 * GET /api/cron/soundcloud — harvest followers of active seed accounts.
 * Resumable: each run continues from the stored cursor.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { harvestSeedFollowers, verifyActiveArtists, refreshPromoterProfiles } from "@/lib/soundcloud";
import { enrichScBatch } from "@/lib/soundcloudEnrich";
import { defendDbSpace } from "@/lib/dbGuard";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
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
  // Seed order (throughput is everything): NEVER-harvested seeds first — they
  // yield the most NEW artists (a re-harvest of a completed seed resumes at an
  // exhausted cursor and returns ~0). Among equally-fresh seeds, prefer Re-Ex /
  // promoter (priority 2, paying advertisers whose followers are high-intent
  // artists). Only once the fresh backlog is drained do we refresh completed
  // seeds (gold at 5d, cold graph at 14d) for their new followers.
  const seeds = harvestOk
    ? await pool.query<{ permalink: string }>(
        `SELECT permalink FROM sc_seed_accounts
         WHERE active = true AND (
           completed_at IS NULL
           OR (priority >= 2 AND completed_at < now() - interval '5 days')
           OR (priority < 2 AND completed_at < now() - interval '14 days'))
         ORDER BY (completed_at IS NULL) DESC, priority DESC, last_harvested_at ASC NULLS FIRST LIMIT 8`)
    : { rows: [] as { permalink: string }[] };

  // Harvest FIRST and give it the budget — it's the only step that adds leads.
  // Grooming (verify/enrich) is kept minimal so a run finishes well under the
  // 120s limit and reliably harvests every cycle. enrich especially is slow
  // (many HTTP fetches/artist) and low-yield, so only a tiny slice per run.
  // Each stage is isolated: a throw in grooming must NOT kill the harvest (that
  // silently stopped lead collection for a day).
  const results = [];
  for (const s of seeds.rows) {
    try {
      const r = await harvestSeedFollowers(s.permalink, 2);
      results.push({ seed: s.permalink, ...r });
    } catch (e) {
      results.push({ seed: s.permalink, harvested: 0, withEmail: 0, done: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const verified = await verifyActiveArtists(8).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  const promoterProfiles = await refreshPromoterProfiles(5).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  const enriched = await enrichScBatch(4).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  // Dynamic bloat control: keep the regenerable HTML cache tightly bounded so it
  // never balloons between daily truncates (it was the #1 space hog at 172MB).
  await pool.query("DELETE FROM url_cache WHERE fetched_at < now() - interval '6 hours'").catch(() => {});

  // Self-expanding seed pool — promote fresh harvested artists in the follower
  // sweet-spot (500-100k: has artist followers, not a mega fan-channel) into
  // seeds BEFORE the prune below deletes the email-less ones. The seed row
  // (just a permalink) persists even after the sc_artists row is pruned, so the
  // graph keeps growing and the harvest never runs dry again.
  const newSeeds = await pool.query(
    `INSERT INTO sc_seed_accounts (permalink, soundcloud_id, username, followers_count, active, priority)
     SELECT permalink, soundcloud_id, COALESCE(username, full_name, permalink), followers_count, true,
            CASE WHEN is_promoter THEN 2 ELSE 0 END
     FROM sc_artists a
     WHERE permalink IS NOT NULL AND (is_promoter = true OR followers_count BETWEEN 500 AND 100000)
       AND harvested_at > now() - interval '25 hours'
       AND NOT EXISTS (SELECT 1 FROM sc_seed_accounts s WHERE s.permalink = a.permalink)
     ORDER BY (is_promoter) DESC, followers_count DESC LIMIT 500
     ON CONFLICT (permalink) DO NOTHING`
  ).then((r) => r.rowCount ?? 0).catch(() => 0);

  // STEADY-STATE ENGINE — the key to running forever without filling the 512MB
  // tier. The valuable output is the EMAIL. A follower harvested >24h ago with
  // no email (bio email is extracted at harvest; enrichment had its chance) is
  // dry ballast for outreach — prune it every run. We KEEP forever: anyone with
  // an email, every promoter, and every tier-A gem. This holds the DB flat so
  // the harvest never halts, and lets us sweep all 734 seeds permanently.
  const pruned = await pool.query(
    `DELETE FROM sc_artists
     WHERE email IS NULL AND is_promoter = false AND COALESCE(tier,'C') <> 'A'
       AND harvested_at < now() - interval '24 hours'`
  ).then((r) => r.rowCount ?? 0).catch(() => 0);

  // Silent-death watchdog: if we HAD seeds to harvest but every one errored
  // (SoundCloud changed structure / getClientId broke / IP throttled), the
  // pipeline is dead. Track the streak and alert on Telegram after 3 bad runs
  // (~1.5h) so it never dies unnoticed for weeks like the old ingestion did.
  if (harvestOk && seeds.rows.length > 0) {
    const allErrored = results.every((r) => r.error);
    const streakRow = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='sc_harvest_fail_streak'`).then((r) => r.rows[0]?.value).catch(() => "0");
    const streak = allErrored ? (parseInt(streakRow ?? "0", 10) || 0) + 1 : 0;
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('sc_harvest_fail_streak', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`, [String(streak)]
    ).catch(() => {});
    if (streak === 3) {
      await sendTelegramMessage(
        `🔴 SoundCloud-харвест зупинився: 3 прогони поспіль усі сіди повертають помилку.\n` +
        `Ймовірно, SoundCloud змінив структуру (getClientId) або throttle. Ліди не збираються — треба глянути.`
      );
    }
  }

  return NextResponse.json({ ok: true, dbMb, harvestOk, guard, results, verified, promoterProfiles, enriched, newSeeds, pruned, ts: new Date().toISOString() });
  } catch (e) {
    // Never 500 silently — a dead harvest = no leads. Surface the error so it's
    // visible in the response and Vercel logs.
    console.error("[cron/soundcloud] fatal:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4) : undefined }, { status: 200 });
  }
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
