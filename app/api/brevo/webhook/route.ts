/**
 * POST /api/brevo/webhook — Brevo delivery/engagement events feed the email
 * verification funnel. Works for BOTH Beatport and SoundCloud (keyed by email).
 * Configure in Brevo: Transactional > Settings > Webhook → this URL, all events.
 *
 * Events → email_status:
 *   delivered            → 'delivered' (alive candidate)
 *   opened/click         → 'engaged'   (🔥 opened / clicked)
 *   hard_bounce/blocked  → 'bounced'   (💀 dead, drop from sends)
 *   unsubscribed/spam    → 'unsub'     (💀 dead + blacklist)
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  // Brevo may batch; normalize to an array.
  const events: Record<string, unknown>[] = Array.isArray(body) ? body : [body];

  for (const e of events) {
    const email = String(e.email ?? "").trim().toLowerCase();
    const event = String(e.event ?? e["event"] ?? "").toLowerCase();
    if (!email || !event) continue;

    await pool.query(`INSERT INTO email_events (email, event, meta) VALUES ($1,$2,$3)`, [email, event, e]).catch(() => {});

    if (event === "delivered") {
      await pool.query(
        `UPDATE sc_artists SET delivered_at=COALESCE(delivered_at, now()),
           email_status=CASE WHEN email_status IN ('engaged','bounced','unsub') THEN email_status ELSE 'delivered' END,
           updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    } else if (event === "opened" || event === "unique_opened" || event === "click") {
      const isClick = event === "click";
      await pool.query(
        `UPDATE sc_artists SET
           opens = opens + ${isClick ? 0 : 1}, clicks = clicks + ${isClick ? 1 : 0},
           first_open_at = COALESCE(first_open_at, now()),
           email_status = CASE WHEN email_status='bounced' OR email_status='unsub' THEN email_status ELSE 'engaged' END,
           updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    } else if (event === "hard_bounce" || event === "blocked" || event === "invalid_email") {
      await pool.query(`UPDATE sc_artists SET email_status='bounced', lead_status='Bounced', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
    } else if (event === "unsubscribed" || event === "spam" || event === "list_addition") {
      await pool.query(`UPDATE sc_artists SET email_status='unsub', lead_status='Unsubscribed', updated_at=now() WHERE LOWER(email)=$1`, [email]).catch(() => {});
      await pool.query(`INSERT INTO email_blacklist (email, reason) VALUES ($1,'brevo:'||$2) ON CONFLICT DO NOTHING`, [email, event]).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, processed: events.length });
}
