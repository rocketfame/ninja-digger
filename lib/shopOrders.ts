/**
 * Mirror of shop orders (Shopify Admin API, read_orders), rolling 60 days.
 * The mass channel's conversion is measured against this table three ways:
 * a MAX* discount code, the buyer's email in our lead ledger, or a landing
 * page tagged utm_source=offers — so a lead who bought without the code is
 * still counted.
 */
import { pool } from "@/lib/db";

const API = "2025-04";

/** The reply-desk / mass-channel codes. Anything else is the shop's own marketing. */
export const MASS_CODES = ["MAXCLOUD", "MAXSPOTIFY", "MAXYOUTUBE", "MAXBEATPORT", "MAXAPPLE", "MAXSOCIAL"];

type Order = {
  id: number; name?: string; email?: string | null; total_price?: string; currency?: string;
  discount_codes?: { code: string }[]; landing_site?: string | null; created_at: string;
};

function utmSource(landing: string | null | undefined): string | null {
  if (!landing) return null;
  try { return new URL(landing, "https://promosoundgroup.net").searchParams.get("utm_source"); } catch { return null; }
}

export async function syncShopOrders(sinceDays = 60, budgetMs = 120_000): Promise<{ seen: number; upserted: number; complete: boolean }> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN, store = process.env.SHOPIFY_STORE;
  if (!token || !store) return { seen: 0, upserted: 0, complete: false };
  const deadline = Date.now() + budgetMs;
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  let url: string | null = `https://${store}.myshopify.com/admin/api/${API}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=id,name,email,total_price,currency,discount_codes,landing_site,created_at`;
  let seen = 0, upserted = 0, complete = false;
  while (url) {
    if (Date.now() > deadline) break;
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    if (!res.ok) throw new Error(`Shopify orders → ${res.status}`);
    const j = (await res.json()) as { orders?: Order[] };
    const rows = j.orders ?? [];
    seen += rows.length;
    for (const o of rows) {
      const r = await pool.query(
        `INSERT INTO shop_orders (order_id, name, email, total, currency, codes, landing, utm_source, created_at, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (order_id) DO UPDATE SET email = EXCLUDED.email, total = EXCLUDED.total, codes = EXCLUDED.codes, synced_at = now()`,
        [o.id, o.name ?? null, (o.email ?? "").trim().toLowerCase() || null, o.total_price ?? "0", o.currency ?? null,
         (o.discount_codes ?? []).map((c) => c.code.toUpperCase()), o.landing_site ?? null, utmSource(o.landing_site), o.created_at]
      );
      upserted += r.rowCount ?? 0;
    }
    const link = res.headers.get("link") ?? "";
    const next: string | null = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    url = next;
    if (!next) complete = true;
  }
  return { seen, upserted, complete };
}
