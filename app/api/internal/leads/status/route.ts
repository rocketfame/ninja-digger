/**
 * GET /api/internal/leads/status?email=a@b.com[,c@d.com…]
 *
 * One answer per address, so neither side has to guess:
 *   - what WE sent from the outreach domain, and when
 *   - what the marketing side sent from the main domain, and when
 *   - what the person did about it (opened, clicked, replied)
 *   - who owns the address right now, and whether it may be mailed
 *
 * There is no reconciliation step: both sides write into email_events, so this
 * reads one timeline rather than comparing two systems.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { OPEN_EVENTS } from "@/lib/leadPolicy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request): boolean {
  const token = process.env.LEADGEN_TOKEN;
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return true;
  return isAuthorized(request);
}

type Row = {
  email: string;
  cold_sent_at: string | null; cold_template: string | null; cold_sender: string | null;
  replied_at: string | null;
  exported_at: string | null; batch: string | null; outcome: string | null; outcome_at: string | null;
  opens: string; clicks: string; esputnik_sends: string; last_event: string | null; last_event_at: string | null;
  suppressed_reason: string | null;
};

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  const q = new URL(request.url).searchParams;
  const emails = (q.get("email") ?? q.get("emails") ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 200);
  if (emails.length === 0) return NextResponse.json({ error: "email= required" }, { status: 400 });

  const openList = OPEN_EVENTS.map((e) => `'${e}'`).join(",");
  const rows = await pool
    .query<Row>(
      `WITH addr AS (SELECT UNNEST($1::text[]) email)
       SELECT a.email,
              o.sent_at cold_sent_at, o.template_id cold_template, o.sender cold_sender, o.replied_at,
              le.exported_at, le.batch, le.outcome, le.outcome_at,
              COALESCE(ev.opens,0)::text opens, COALESCE(ev.clicks,0)::text clicks,
              COALESCE(ev.esputnik_sends,0)::text esputnik_sends,
              ev.last_event, ev.last_event_at,
              bl.reason suppressed_reason
         FROM addr a
         LEFT JOIN LATERAL (
              SELECT sent_at, template_id, sender, replied_at FROM outreach_events
               WHERE channel='email' AND LOWER(contact_value) = a.email
               ORDER BY sent_at DESC LIMIT 1) o ON TRUE
         LEFT JOIN lead_exports le ON le.email = a.email
         LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE event IN (${openList}) AND event NOT LIKE 'click%') opens,
                     COUNT(*) FILTER (WHERE event LIKE 'click%') clicks,
                     COUNT(*) FILTER (WHERE meta->>'src' = 'esputnik' AND event IN ('sent','delivered')) esputnik_sends,
                     (ARRAY_AGG(event ORDER BY ts DESC))[1] last_event,
                     MAX(ts) last_event_at
                FROM email_events WHERE email = a.email) ev ON TRUE
         LEFT JOIN LATERAL (
              SELECT reason FROM email_blacklist WHERE LOWER(email) = a.email LIMIT 1) bl ON TRUE`,
      [emails]
    )
    .then((r) => r.rows)
    .catch((e) => { console.error("[leads/status] query failed:", e); return null; });

  if (rows === null) return NextResponse.json({ error: "query failed" }, { status: 500 });

  const leads = rows.map((r) => {
    const heldByMarketing = r.exported_at !== null && (r.outcome ?? "") !== "cold";
    // Cold mail is one letter per lead, so a lead we already wrote to is done
    // regardless of who owns it — a follow-up is a manual, approved reply.
    const alreadyCold = r.cold_sent_at !== null;
    const reason = r.suppressed_reason
      ? `suppressed: ${r.suppressed_reason}`
      : heldByMarketing ? "held by the marketing side"
      : alreadyCold ? "already had its one cold email"
      : null;

    return {
      email: r.email,
      owner: r.suppressed_reason ? "nobody" : heldByMarketing ? "marketing" : "outreach",
      may_cold_mail: reason === null,
      reason,
      cold: r.cold_sent_at
        ? { sent_at: r.cold_sent_at, template: r.cold_template, sender: r.cold_sender, replied_at: r.replied_at }
        : null,
      marketing: r.exported_at
        ? { exported_at: r.exported_at, batch: r.batch, outcome: r.outcome, outcome_at: r.outcome_at, sends: Number(r.esputnik_sends) }
        : null,
      engagement: {
        opens: Number(r.opens),
        clicks: Number(r.clicks),
        replied: r.replied_at !== null,
        last_event: r.last_event,
        last_event_at: r.last_event_at,
      },
    };
  });

  return NextResponse.json({ count: leads.length, leads, ts: new Date().toISOString() });
}
