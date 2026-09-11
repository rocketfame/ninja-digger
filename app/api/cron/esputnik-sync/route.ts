/**
 * GET /api/cron/esputnik-sync — the mass channel's heartbeat, hourly.
 *   1. pull outcomes since the cursor (rolling 2-day overlap; events dedupe)
 *   2. delete contacts whose cycle is over (eSputnik bills per contact)
 *   3. once a day, push the next batch: app_settings.esputnik_daily_push
 *      addresses per platform in esputnik_push_platforms (default all three
 *      mass platforms). 0 = off, which is the default: nothing leaves until
 *      the user sets the knob.
 */
import { NextResponse } from "next/server";
import { acquireLease } from "@/lib/cronLock";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { esputnikConfigured, pullEsputnikActivity, pushToEsputnik, retireColdFromEsputnik } from "@/lib/esputnik";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!esputnikConfigured()) return NextResponse.json({ ok: true, skipped: "ESPUTNIK_API_KEY not set" });
  if (!(await acquireLease("esputnik-sync", 10))) return NextResponse.json({ ok: true, skipped: "locked" });

  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // 1. outcomes
  const since = (await getSetting("esputnik_poll_since", "")) || today;
  const from = new Date(Date.parse(since.slice(0, 10)) - 2 * 86400000);
  const pulled = await pullEsputnikActivity(from, new Date()).catch((e) => ({ seen: 0, logged: 0, suppressed: 0, error: e instanceof Error ? e.message : String(e) }));
  if (!("error" in pulled)) await setSetting("esputnik_poll_since", today).catch(() => {});

  // 2. cycle over → out of eSputnik
  const retired = await retireColdFromEsputnik().catch((e) => ({ deleted: 0, failed: 0, error: e instanceof Error ? e.message : String(e) }));

  // 3. the day's push
  const perPlatform = parseInt(await getSetting("esputnik_daily_push", "0"), 10) || 0;
  const lastPush = await getSetting("esputnik_last_push_date", "");
  const platforms = (await getSetting("esputnik_push_platforms", "soundcloud,spotify,youtube"))
    .split(",").map((s) => s.trim().toLowerCase()).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p) && p !== "beatport");
  const pushes: { group: string; pushed: number; failed: number; error?: string }[] = [];
  if (perPlatform > 0 && lastPush !== today) {
    for (const p of platforms) {
      if (Date.now() - t0 > 240_000) break;
      pushes.push(await pushToEsputnik(p, perPlatform).catch((e) => ({ group: p, pushed: 0, failed: 0, error: e instanceof Error ? e.message : String(e) })));
    }
    if (pushes.some((x) => x.pushed > 0)) await setSetting("esputnik_last_push_date", today).catch(() => {});
    const lines = pushes.map((x) => `• ${x.group}: ${x.pushed}${x.failed ? ` (помилок ${x.failed})` : ""}${x.error ? ` ✗ ${x.error.slice(0, 80)}` : ""}`);
    await sendTelegramMessage(`📤 eSputnik: сегменти на сьогодні\n${lines.join("\n")}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, pulled, retired, pushes, perPlatform, tookMs: Date.now() - t0, ts: new Date().toISOString() });
}
