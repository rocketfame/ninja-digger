/**
 * GET /api/internal/debug/port25 — one-off probe: can this runtime open an
 * outbound SMTP connection (port 25)? Decides whether mailbox verification can
 * live in a cron or must stay a local script. Delete once answered.
 */
import { NextResponse } from "next/server";
import net from "node:net";
import dns from "node:dns/promises";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function tryPort(host: string, port: number, ms = 8000) {
  return new Promise<string>((resolve) => {
    const t0 = Date.now();
    const s = net.createConnection({ host, port, timeout: ms });
    const fin = (r: string) => { try { s.destroy(); } catch { /* closed */ } resolve(`${r} (${Date.now() - t0}ms)`); };
    s.on("connect", () => fin("CONNECTED"));
    s.on("timeout", () => fin("TIMEOUT"));
    s.on("error", (e) => fin(`ERROR ${e.message}`));
  });
}

export async function GET() {
  const mx = await dns.resolveMx("gmail.com").then((r) => r[0]?.exchange).catch(() => null);
  return NextResponse.json({
    runtime: process.env.VERCEL ? "vercel" : "other",
    mxLookup: mx,
    port25: mx ? await tryPort(mx, 25) : "no mx",
    port587_control: await tryPort("smtp-relay.brevo.com", 587),
    ts: new Date().toISOString(),
  });
}
