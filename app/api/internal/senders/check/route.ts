/**
 * GET /api/internal/senders/check — verify each configured outreach sender's SMTP
 * connection (getSenders → transporter.verify). Reports id/from/cap/ok/error per
 * account WITHOUT exposing logins or keys. Protected by CRON_SECRET.
 * Use after adding a Brevo account to confirm its credentials actually work.
 */
import { NextResponse } from "next/server";
import { getSenders, senderTransport } from "@/lib/outreachSenders";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const senders = getSenders();
  const results = await Promise.all(
    senders.map(async (s) => {
      const t = senderTransport(s);
      try {
        await t.verify();
        return { id: s.id, from: s.from, cap: s.cap, ok: true };
      } catch (e) {
        return { id: s.id, from: s.from, cap: s.cap, ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) };
      }
    })
  );
  return NextResponse.json({ count: senders.length, senders: results, ts: new Date().toISOString() });
}
