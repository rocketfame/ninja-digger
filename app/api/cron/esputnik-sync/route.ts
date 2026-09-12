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
import { shopConfigured, syncShopCustomers } from "@/lib/shopCustomers";

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
  const pulled = await pullEsputnikActivity(from, new Date(), 150_000).catch((e) => ({ seen: 0, logged: 0, suppressed: 0, complete: false, error: e instanceof Error ? e.message : String(e) }));
  // the cursor moves only when the whole window was read; a partial read is
  // simply repeated next hour (events dedupe on (email, event, ts))
  if (!("error" in pulled) && pulled.complete) await setSetting("esputnik_poll_since", today).catch(() => {});

  // 2. cycle over → out of eSputnik
  const retired = await retireColdFromEsputnik().catch((e) => ({ deleted: 0, customers: 0, failed: 0, error: e instanceof Error ? e.message : String(e) }));

  // 2b. the shop's customer list, refreshed before any push (fourth line of
  //     "leads ≠ customers"): a missing/failed sync blocks the push today.
  let shop: { seen: number; upserted: number; complete: boolean; error?: string } = { seen: 0, upserted: 0, complete: false };
  if (shopConfigured()) {
    const lastShop = await getSetting("shop_customers_synced", "");
    if (lastShop !== today) {
      shop = await syncShopCustomers().catch((e) => ({ seen: 0, upserted: 0, complete: false, error: e instanceof Error ? e.message : String(e) }));
      if (shop.complete) await setSetting("shop_customers_synced", today).catch(() => {});
    } else shop.complete = true;
  }
  const shopOk = !shopConfigured() || shop.complete;

  // 3. the day's push
  const perPlatform = parseInt(await getSetting("esputnik_daily_push", "0"), 10) || 0;
  const lastPush = await getSetting("esputnik_last_push_date", "");
  const platforms = (await getSetting("esputnik_push_platforms", "soundcloud,spotify,youtube"))
    .split(",").map((s) => s.trim().toLowerCase()).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p) && p !== "beatport");
  const pushes: { group: string; pushed: number; failed: number; customers: number; purged: number; error?: string }[] = [];
  if (perPlatform > 0 && lastPush !== today && !shopOk) {
    await sendTelegramMessage(`⛔ eSputnik push відкладено: список клієнтів Shopify не синхронізувався${shop.error ? ` (${shop.error.slice(0, 100)})` : ""}. Спробую наступної години.`).catch(() => {});
  }
  if (perPlatform > 0 && lastPush !== today && shopOk) {
    for (const p of platforms) {
      if (Date.now() - t0 > 240_000) break;
      pushes.push(await pushToEsputnik(p, perPlatform).catch((e) => ({ group: p, pushed: 0, failed: 0, customers: 0, purged: 0, error: e instanceof Error ? e.message : String(e) })));
    }
    if (pushes.some((x) => x.pushed > 0)) await setSetting("esputnik_last_push_date", today).catch(() => {});
    const lines = pushes.map((x) => `• ${x.group}: ${x.pushed}${x.customers ? ` · клієнтів пропущено ${x.customers}` : ""}${x.purged ? ` · клієнтів ВИЛУЧЕНО з групи ${x.purged}` : ""}${x.failed ? ` (не долетіло ${x.failed})` : ""}${x.error ? ` ✗ ${x.error.slice(0, 80)}` : ""}`);
    await sendTelegramMessage(`📤 eSputnik: сегменти на сьогодні\n${lines.join("\n")}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, pulled, retired, shop, pushes, perPlatform, tookMs: Date.now() - t0, ts: new Date().toISOString() });
}
