/**
 * Mirror of the shop's customer list (Shopify Admin API, read_customers).
 * The shop is the source of truth for "is a customer"; eSputnik only knows
 * what was synced into it. The mass channel (and the personal one, through
 * SUPPRESSED-style exclusion in massEligibleSql) excludes every address here.
 */
import { pool } from "@/lib/db";

const API = "2025-04";

export function shopConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE);
}

type Customer = { id: number; email: string | null; orders_count?: number; created_at?: string };

/** Full pull of all customers with an email, in pages of 250. */
export async function syncShopCustomers(budgetMs = 240_000): Promise<{ seen: number; upserted: number; complete: boolean }> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN!, store = process.env.SHOPIFY_STORE!;
  const deadline = Date.now() + budgetMs;
  let url: string | null = `https://${store}.myshopify.com/admin/api/${API}/customers.json?limit=250&fields=id,email,orders_count,created_at`;
  let seen = 0, upserted = 0, complete = false;
  while (url) {
    if (Date.now() > deadline) break;
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    if (!res.ok) throw new Error(`Shopify customers → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { customers?: Customer[] };
    const rows = (j.customers ?? []).filter((c) => c.email);
    seen += j.customers?.length ?? 0;
    if (rows.length) {
      const r = await pool.query(
        `INSERT INTO shop_customers (email, shopify_id, orders_count, created_at, synced_at)
         SELECT LOWER(e), i, o, c, now() FROM UNNEST($1::text[], $2::bigint[], $3::int[], $4::timestamptz[]) AS t(e, i, o, c)
         ON CONFLICT (email) DO UPDATE SET shopify_id = EXCLUDED.shopify_id, orders_count = EXCLUDED.orders_count, synced_at = now()`,
        [rows.map((c) => c.email!.trim()), rows.map((c) => c.id), rows.map((c) => c.orders_count ?? 0), rows.map((c) => c.created_at ?? null)]
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
