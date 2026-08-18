/**
 * GET /api/unsubscribe?u=<base64url(email)> — one-click opt-out for cold email.
 * Adds the address to email_blacklist and marks the SC lead Unsubscribed so it
 * is never contacted again. Returns a plain confirmation page.
 */
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

function decode(u: string): string | null {
  try {
    const b64 = u.replace(/-/g, "+").replace(/_/g, "/");
    const email = Buffer.from(b64, "base64").toString("utf8").trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  } catch { return null; }
}

function page(msg: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Unsubscribe</title>
     <div style="font:16px/1.5 system-ui;max-width:420px;margin:15vh auto;padding:0 24px;text-align:center;color:#111">
       <h2 style="font-weight:600">PromoSound</h2><p>${msg}</p>
     </div>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  const u = new URL(request.url).searchParams.get("u") ?? "";
  const email = decode(u);
  if (!email) return page("Invalid link.");
  await pool.query(
    `INSERT INTO email_blacklist (email) VALUES ($1) ON CONFLICT DO NOTHING`, [email]
  ).catch(() => {});
  await pool.query(
    `UPDATE sc_artists SET lead_status='Unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]
  ).catch(() => {});
  return page("You're unsubscribed. You won't hear from us again.");
}
