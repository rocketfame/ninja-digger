/**
 * POST /api/internal/sc-outreach/test?to=<email>&name=<name> — sends the three
 * outreach touches to ONE address for review. Test only; does not touch leads
 * or the blacklist. Use with your own inbox to see how the copy lands.
 */
import { NextResponse } from "next/server";
import { getOutreachMailer } from "@/lib/mailer";
import { buildScEmail } from "@/lib/scOutreachCopy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to");
  const name = searchParams.get("name") ?? "Alex";
  const pct = parseInt(searchParams.get("pct") ?? "20", 10) || 20;
  const code = searchParams.get("code") ?? "SOUND20";
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: "valid ?to= required" }, { status: 400 });
  }
  const mailer = getOutreachMailer();
  if (!mailer) return NextResponse.json({ ok: false, error: "no mailer" }, { status: 500 });
  const { transporter, from, replyTo } = mailer;
  const unsubUrl = `https://ninja-digger.vercel.app/api/unsubscribe?u=${Buffer.from(to).toString("base64url")}`;

  const sent: number[] = [];
  for (const touch of [1, 2, 3] as const) {
    const e = buildScEmail(touch, { name, pct, code, unsubUrl });
    await transporter.sendMail({ from, replyTo, to, subject: `[TEST ${touch}/3] ${e.subject}`, text: e.text });
    sent.push(touch);
  }
  return NextResponse.json({ ok: true, to, sent, note: "3 touches delivered" });
}
