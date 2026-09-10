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
 *
 * The owner types the password ONCE per browser. A successful Basic Auth sets
 * a signed cookie good for a year, and the cookie is checked first, so the
 * prompt never comes back. The cookie is an HMAC of a fixed label under the
 * password itself: nothing to store, nothing to expire server-side, and
 * rotating DASHBOARD_PASS invalidates every browser at once. Strangers still
 * hit the 401 wall — a cookie cannot be forged without the password.
 */
const PUBLIC_PREFIXES = ["/api/cron", "/api/telegram", "/api/brevo", "/api/unsubscribe"];
const SESSION_COOKIE = "nd_session";
const SESSION_TTL_S = 365 * 24 * 3600;

/** HMAC-SHA256("ninja-digger-session-v1") keyed by the dashboard password, hex. Edge-safe. */
async function sessionToken(pass: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ninja-digger-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return NextResponse.next(); // not configured → stay open (no lockout)

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const authz = req.headers.get("authorization") || "";

  // Machine calls (Vercel cron → /api/internal/*) use the CRON_SECRET bearer.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authz === `Bearer ${cronSecret}`) return NextResponse.next();

  // Returning owner → the cookie set on a previous successful login.
  const token = await sessionToken(pass);
  if (req.cookies.get(SESSION_COOKIE)?.value === token) return NextResponse.next();

  // First visit → Basic Auth, and remember this browser for a year.
  if (authz.startsWith("Basic ")) {
    try {
      const [u, p] = atob(authz.slice(6)).split(":");
      if (u === (process.env.DASHBOARD_USER || "admin") && p === pass) {
        const res = NextResponse.next();
        res.cookies.set(SESSION_COOKIE, token, { path: "/", maxAge: SESSION_TTL_S, httpOnly: true, secure: true, sameSite: "lax" });
        return res;
      }
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
