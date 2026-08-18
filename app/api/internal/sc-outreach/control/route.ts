/**
 * POST /api/internal/sc-outreach/control?paused=0|1&discount=25&code=... — flips
 * the SC outreach engine on/off and tweaks the offer, no redeploy needed.
 * GET returns the current settings + queue.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function set(key: string, value: string) {
  await pool.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]).catch(() => {});
}
async function get(key: string, fb: string) {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key]).then((r) => r.rows[0]?.value ?? fb).catch(() => fb);
}

export async function GET() {
  return NextResponse.json({
    paused: (await get("sc_outreach_paused", "1")) === "1",
    discount: await get("sc_discount", "25"),
    code: await get("sc_promo_code", "SOUND20"),
    start: await get("sc_outreach_start", ""),
  });
}

export async function POST(request: Request) {
  const p = new URL(request.url).searchParams;
  if (p.has("paused")) await set("sc_outreach_paused", p.get("paused") === "0" ? "0" : "1");
  if (p.has("discount")) await set("sc_discount", String(parseInt(p.get("discount") || "25", 10) || 25));
  if (p.has("code")) await set("sc_promo_code", p.get("code") || "SOUND20");
  return NextResponse.json({
    ok: true,
    paused: (await get("sc_outreach_paused", "1")) === "1",
    discount: await get("sc_discount", "25"),
    code: await get("sc_promo_code", "SOUND20"),
  });
}
