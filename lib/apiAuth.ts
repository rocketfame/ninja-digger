import { NextResponse } from "next/server";

/**
 * Node-runtime auth guard for sensitive API routes (data exports, destructive
 * mutations). Middleware Basic Auth does NOT cover /api anymore — CRON_SECRET
 * isn't reliably readable in the Edge runtime, which was silently 401-ing Vercel
 * cron calls to /api/internal/* (broke enrichment). So these checks live in the
 * routes themselves, where env vars are always available.
 *
 * Authorized = a machine with the CRON_SECRET bearer, OR a human with the
 * dashboard Basic Auth. INERT (open) until DASHBOARD_PASS is set, matching the
 * middleware's no-lockout behavior.
 */
export function isAuthorized(req: Request): boolean {
  const authz = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET;
  if (cron && authz === `Bearer ${cron}`) return true;
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return true; // not configured → open (no lockout)
  if (authz.startsWith("Basic ")) {
    try {
      const [u, p] = atob(authz.slice(6)).split(":");
      if (u === (process.env.DASHBOARD_USER || "admin") && p === pass) return true;
    } catch { /* malformed */ }
  }
  return false;
}

export function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ninja Digger", charset="UTF-8"' },
  });
}
