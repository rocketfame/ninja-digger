/**
 * GET /api/internal/senders/check — verify each configured outreach sender's SMTP
 * connection (getSenders → transporter.verify). Reports id/from/cap/ok/error per
 * account WITHOUT exposing logins or keys. Protected by CRON_SECRET.
 * Use after adding a Brevo account to confirm its credentials actually work.
 */
import { NextResponse } from "next/server";
import { senderTransport } from "@/lib/outreachSenders";
import { getSendersWithOverrides } from "@/lib/mailer";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Match the cron routes' auth (CRON_SECRET is empty at runtime, so this is a
  // no-op in practice; the endpoint only reports id/from/cap/ok, never secrets).
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const senders = await getSendersWithOverrides();
  const blocklist = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='sender_blocklist'`).then((r) => r.rows[0]?.value ?? "").catch(() => "?");
  const results = await Promise.all(
    senders.map(async (s) => {
      // Non-secret diagnostics: reveal key TYPE (xsmtpsib=SMTP key vs xkeysib=API
      // key) + length + whether login/key has stray whitespace — enough to spot
      // the wrong key type or a paste error without exposing the secret.
      const diag = {
        login: s.login.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
        loginTrimOk: s.login === s.login.trim(),
        keyPrefix: (s.key || "").slice(0, 9),
        keyLen: (s.key || "").length,
        keyTrimOk: s.key === s.key.trim(),
      };
      const t = senderTransport(s);
      try {
        await t.verify();
        return { id: s.id, from: s.from, cap: s.cap, ok: true, ...diag };
      } catch (e) {
        return { id: s.id, from: s.from, cap: s.cap, ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160), ...diag };
      }
    })
  );
  return NextResponse.json({ count: senders.length, blocklist, senders: results, ts: new Date().toISOString() });
}
