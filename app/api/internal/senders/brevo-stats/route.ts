/**
 * GET /api/internal/senders/brevo-stats?days=10 — server-side Brevo diagnostics
 * for the PRIMARY account (BREVO_API_KEY): account plan/credits + per-day
 * aggregated SMTP report (requests/delivered/opens/bounces/blocked). Exposes only
 * counts, never keys. Used to verify that what we hand to the SMTP relay is
 * actually delivered (our funnel showed 0 delivered since 2026-08-30).
 */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const key = process.env.BREVO_API_KEY;
  if (!key) return NextResponse.json({ error: "no BREVO_API_KEY" }, { status: 500 });
  const days = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 10));
  const h = { "api-key": key, accept: "application/json" };
  const get = async (path: string) => {
    const r = await fetch(`https://api.brevo.com/v3${path}`, { headers: h });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  };
  const [account, reports, events] = await Promise.all([
    get("/account"),
    get(`/smtp/statistics/reports?days=${days}`),
    get("/smtp/statistics/events?limit=5&days=1&sort=desc"),
  ]);
  const acc = account.body as { email?: string; companyName?: string; plan?: { type?: string; credits?: number; creditsType?: string }[] };
  return NextResponse.json({
    account: { status: account.status, email: acc.email, company: acc.companyName, plan: acc.plan },
    reports: { status: reports.status, rows: (reports.body as { reports?: unknown[] }).reports ?? reports.body },
    eventsToday: { status: events.status, sample: events.body },
    ts: new Date().toISOString(),
  });
}
