/**
 * GET /api/cron/esputnik-sync — the mass channel's heartbeat, hourly.
 *
 *   1. pull outcomes from eSputnik (rolling 2-day overlap; events dedupe)
 *   2. refresh the shop mirrors (customers daily, orders 3 days hourly)
 *   3. reconcile: delivered counts per open group, lead segments
 *   4. advance the cycle: delete delivered groups → schedule campaigns for
 *      filled groups → fill a new cycle up to the ceiling if none is open
 *
 * Every step is idempotent; a slow or failed run resumes next hour.
 * Off until esputnik_daily_push > 0.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { acquireLease } from "@/lib/cronLock";
import { getSetting, setSetting } from "@/lib/settings";
import { esputnikConfigured, pullEsputnikActivity } from "@/lib/esputnik";
import { shopConfigured, syncShopCustomers } from "@/lib/shopCustomers";
import { syncShopOrders } from "@/lib/shopOrders";
import { advance, reconcile } from "@/lib/massCycle";

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
  const pulled = await pullEsputnikActivity(from, new Date(), 60_000).catch((e) => ({ seen: 0, logged: 0, suppressed: 0, complete: false, error: e instanceof Error ? e.message : String(e) }));
  if (!("error" in pulled) && pulled.complete) await setSetting("esputnik_poll_since", today).catch(() => {});

  // 2. shop mirrors
  let shop: { seen: number; upserted: number; complete: boolean; error?: string } = { seen: 0, upserted: 0, complete: true };
  if (shopConfigured() && (await getSetting("shop_customers_synced", "")) !== today) {
    shop = await syncShopCustomers(60_000).catch((e) => ({ seen: 0, upserted: 0, complete: false, error: e instanceof Error ? e.message : String(e) }));
    if (shop.complete) await setSetting("shop_customers_synced", today).catch(() => {});
  }
  const orders = shopConfigured() ? await syncShopOrders(3, 20_000).catch(() => ({ seen: 0, upserted: 0, complete: false })) : null;

  // 3. reconcile
  const rec = await reconcile().catch((e) => ({ groups: 0, segmented: 0, error: e instanceof Error ? e.message : String(e) }));

  // 4. the cycle — only with a customer mirror younger than two days
  const mirrorAgeH = await pool.query<{ h: string }>(`SELECT EXTRACT(EPOCH FROM (now() - MAX(synced_at)))/3600 h FROM shop_customers`).then((r) => Number(r.rows[0]?.h ?? 1e9)).catch(() => 1e9);
  const steps = mirrorAgeH < 48 ? await advance(280_000 - (Date.now() - t0)).catch((e) => [{ step: "error", detail: { error: e instanceof Error ? e.message : String(e) } }]) : [{ step: "skipped", detail: { reason: "shop customer mirror stale" } }];

  return NextResponse.json({ ok: true, pulled, shop, orders, reconcile: rec, steps, tookMs: Date.now() - t0, ts: new Date().toISOString() });
}
