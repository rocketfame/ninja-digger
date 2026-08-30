import { NextResponse, type NextRequest } from "next/server";

/**
 * Gate the whole app behind HTTP Basic Auth so lead data (names, emails, CSV
 * exports) isn't public. INERT until DASHBOARD_PASS is set, so deploying this
 * never locks anyone out — set DASHBOARD_USER + DASHBOARD_PASS on Vercel to
 * turn it on (redeploy not needed for env-only reads on next request).
 *
 * Left public (must stay reachable by machines / recipients):
 *  - /api/cron/*        Vercel cron (already gated by CRON_SECRET)
 *  - /api/telegram/*    Telegram webhook (own secret header)
 *  - /api/brevo/*       Brevo delivery webhooks
 *  - /api/unsubscribe   recipients click this from emails
 *  - any request carrying  Authorization: Bearer <CRON_SECRET>  (machine calls,
 *    e.g. the cron-driven /api/internal/* endpoints)
 */
const PUBLIC_PREFIXES = ["/api/cron", "/api/telegram", "/api/brevo", "/api/unsubscribe"];

export function middleware(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return NextResponse.next(); // not configured → stay open (no lockout)

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const authz = req.headers.get("authorization") || "";

  // Machine calls (Vercel cron → /api/internal/*) use the CRON_SECRET bearer.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authz === `Bearer ${cronSecret}`) return NextResponse.next();

  // Human access → Basic Auth.
  if (authz.startsWith("Basic ")) {
    try {
      const [u, p] = atob(authz.slice(6)).split(":");
      if (u === (process.env.DASHBOARD_USER || "admin") && p === pass) return NextResponse.next();
    } catch { /* malformed header → fall through to 401 */ }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ninja Digger", charset="UTF-8"' },
  });
}

// Run on PAGES only. /api is intentionally excluded: the Edge runtime can't
// reliably read CRON_SECRET, so gating /api here silently 401-ed Vercel cron
// calls to /api/internal/* (broke enrichment). Sensitive API routes (exports,
// destructive mutations) guard themselves via lib/apiAuth in the Node runtime.
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
