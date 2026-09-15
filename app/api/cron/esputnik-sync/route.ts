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
import { pool } from "@/lib/db";
import { acquireLease } from "@/lib/cronLock";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { groupNameFor } from "@/lib/esputnikStatus";
import { esputnikBaseSize, esputnikConfigured, pullEsputnikActivity, pushToEsputnik, retireColdFromEsputnik } from "@/lib/esputnik";
import { shopConfigured, syncShopCustomers } from "@/lib/shopCustomers";
import { syncShopOrders } from "@/lib/shopOrders";

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
      shop = await syncShopCustomers(110_000).catch((e) => ({ seen: 0, upserted: 0, complete: false, error: e instanceof Error ? e.message : String(e) }));
      if (shop.complete) await setSetting("shop_customers_synced", today).catch(() => {});
    } else shop.complete = true;
  }
  // The mirror must exist and be recent (≤ 2 days); a sync that ran out of
  // time today is fine, yesterday's mirror still guards the push.
  const mirrorAge = await pool.query<{ h: string }>(`SELECT EXTRACT(EPOCH FROM (now() - MAX(synced_at)))/3600 h FROM shop_customers`).then((r) => Number(r.rows[0]?.h ?? 1e9)).catch(() => 1e9);
  const shopOk = !shopConfigured() || shop.complete || mirrorAge < 48;
  // 2c. orders: a rolling 3 days every hour, the full 60 days once a day
  const fullOrdersDone = (await getSetting("shop_orders_full", "")) === today;
  const orders = shopConfigured()
    ? await syncShopOrders(3, 30_000).catch((e) => ({ seen: 0, upserted: 0, complete: false, error: e instanceof Error ? e.message : String(e) }))
    : { seen: 0, upserted: 0, complete: false };
  void fullOrdersDone; // the 60-day refresh runs in /api/cron/report-daily, not here

  // 3. the day's push
  const perPlatformRaw = parseInt(await getSetting("esputnik_daily_push", "0"), 10) || 0;
  // THE BASE, NOT THE LEDGER (user, 14.09: "нові користувачі не будуть
  // отримувати емейли — цього не має бути"). eSputnik's plan caps the whole
  // base at esputnik_plan_limit (25 000); the shop's own customers arrive
  // organically and must always fit. So leads may only occupy what is left
  // after the plan limit minus a reserve for organic growth:
  //   seats for leads today = plan_limit − reserve − contacts in the base now
  // The base size is read from eSputnik itself, never estimated.
  // HARD CEILING (user, 15.09: "база не має перевищувати 24 800 — залізобетонне
  // правило"). esputnik_plan_limit is that ceiling, reserve sits under it.
  const planLimit = parseInt(await getSetting("esputnik_plan_limit", "24000"), 10) || 24000;
  const reserve = parseInt(await getSetting("esputnik_reserve", "1500"), 10) || 1500;
  const windowSize = parseInt(await getSetting("esputnik_window", "4500"), 10) || 4500;
  const live = await pool.query<{ c: string }>(`SELECT COUNT(*) c FROM lead_exports WHERE batch LIKE 'Leads: %(auto)' AND COALESCE(outcome,'') NOT IN ('retired','converted','bounced','complained','unsubscribed')`).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  // Never push on a stale number: a cached base let the overnight pushes
  // climb to 25 855. Re-count before every push (20 min cache at most).
  const baseNow = await esputnikBaseSize({ maxAgeMin: 20, budgetMs: 120_000 }).catch(() => null);
  const seatsByPlan = baseNow === null ? 0 : Math.max(0, planLimit - reserve - baseNow);
  const seatsByWindow = Math.max(0, windowSize - live);
  const seatsFree = Math.min(seatsByPlan, seatsByWindow);
  const perPlatform = perPlatformRaw;
  if (baseNow === null) await sendTelegramMessage(`⛔ eSputnik: не зміг прочитати розмір бази — пуш сьогодні не йде.`).catch(() => {});
  if (baseNow !== null && baseNow > planLimit - reserve) await sendTelegramMessage(`⚠️ eSputnik: у базі ${baseNow} з ${planLimit}, резерв ${reserve} для клієнтів порушено — пуш не йде, ротація видаляє.`).catch(() => {});
  const platforms = (await getSetting("esputnik_push_platforms", "soundcloud,spotify,youtube"))
    .split(",").map((s) => s.trim().toLowerCase()).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p) && p !== "beatport");
  const pushes: { group: string; pushed: number; failed: number; customers: number; purged: number; error?: string }[] = [];
  if (perPlatform > 0 && !shopOk) {
    await sendTelegramMessage(`⛔ eSputnik push відкладено: список клієнтів Shopify не синхронізувався${shop.error ? ` (${shop.error.slice(0, 100)})` : ""}. Спробую наступної години.`).catch(() => {});
  }
  // Per-call slice: one Vercel invocation cannot verify 1 700 addresses in
  // 300 s, so each call takes up to esputnik_push_batch per platform and the
  // day's total is capped by mass_pushes (what already landed today).
  const batchCap = parseInt(await getSetting("esputnik_push_batch", "1700"), 10) || 1700;
  const doneToday = await pool.query<{ platform: string; pushed: string }>(`SELECT platform, pushed FROM mass_pushes WHERE day = $1`, [today]).then((r) => Object.fromEntries(r.rows.map((x) => [x.platform, Number(x.pushed)]))).catch(() => ({} as Record<string, number>));
  const remainingToday = platforms.reduce((n, p) => n + Math.max(0, perPlatform - (doneToday[p] ?? 0)), 0);
  if (perPlatform > 0 && shopOk && remainingToday > 0 && seatsFree > 0) {
    let budget = seatsFree;
    for (const p of platforms) {
      if (Date.now() - t0 > 240_000) break;
      const take = Math.min(perPlatform - (doneToday[p] ?? 0), batchCap, budget);
      if (take <= 0) {
        pushes.push({ group: p, pushed: 0, failed: 0, customers: 0, purged: 0, error: `місць нема: база ${baseNow} з ${planLimit}, резерв ${reserve}, лідів ${live} з ${windowSize}` });
        await pool.query(`INSERT INTO mass_pushes (day, platform, planned, budget, pushed) VALUES ($1,$2,$3,0,0) ON CONFLICT (day, platform) DO UPDATE SET planned = EXCLUDED.planned`, [today, p, perPlatform]).catch(() => {});
        continue;
      }
      const res = await pushToEsputnik(p, take).catch((e) => ({ group: p, pushed: 0, failed: 0, customers: 0, purged: 0, error: e instanceof Error ? e.message : String(e) }));
      budget -= res.pushed;
      pushes.push(res);
      await pool.query(
        `INSERT INTO mass_pushes (day, platform, planned, budget, pushed) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (day, platform) DO UPDATE SET planned = EXCLUDED.planned, budget = EXCLUDED.budget, pushed = mass_pushes.pushed + EXCLUDED.pushed`,
        [today, p, perPlatform, take, res.pushed]
      ).catch(() => {});
    }
    if (pushes.some((x) => x.pushed > 0)) await setSetting("esputnik_last_push_date", today).catch(() => {});
    // still budget and still quota → come back right away instead of next hour
    const stillTodo = platforms.reduce((n, p) => n + Math.max(0, perPlatform - (doneToday[p] ?? 0) - (pushes.find((x) => x.group === groupNameFor(p))?.pushed ?? 0)), 0);
    if (stillTodo > 0 && budget > 0) {
      const url = new URL(request.url); url.searchParams.set("again", "1");
      fetch(url.toString(), { headers: { authorization: request.headers.get("authorization") ?? "" } }).catch(() => {});
    }
    const lines = pushes.map((x) => `• ${x.group}: ${x.pushed}${x.customers ? ` · клієнтів пропущено ${x.customers}` : ""}${x.purged ? ` · клієнтів ВИЛУЧЕНО з групи ${x.purged}` : ""}${x.failed ? ` (не долетіло ${x.failed})` : ""}${x.error ? ` ✗ ${x.error.slice(0, 80)}` : ""}`);
    await sendTelegramMessage(`📤 eSputnik: сегменти на сьогодні\n${lines.join("\n")}\nБаза eSputnik: ${baseNow ?? "?"} з ${planLimit} (резерв ${reserve}) · лідів ${live} з ${windowSize} · видалено за годину ${retired.deleted}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, pulled, retired, shop, orders, pushes, perPlatform, planLimit, reserve, baseNow, windowSize, live, seatsFree, tookMs: Date.now() - t0, ts: new Date().toISOString() });
}
