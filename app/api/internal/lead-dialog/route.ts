/**
 * GET /api/internal/lead-dialog?artistId=... — full email conversation with a
 * lead, live from Gmail (INBOX = their messages, Sent = ours), sorted by date.
 */

import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { pool } from "@/lib/db";
import { cleanEmailText } from "@/lib/emailText";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_DAYS = 180;
const MAX_PER_DIRECTION = 12;

type DialogMessage = { direction: "in" | "out"; subject: string; date: string; text: string };

async function collect(
  client: ImapFlow,
  mailbox: string,
  criteria: Record<string, unknown>,
  direction: "in" | "out",
  out: DialogMessage[]
) {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = ((await client.search(criteria, { uid: true }).catch(() => [])) || []).slice(-MAX_PER_DIRECTION);
    for (const uid of uids) {
      let subject = "";
      let date = "";
      for await (const m of client.fetch(String(uid), { envelope: true, uid: true }, { uid: true })) {
        subject = (m.envelope?.subject ?? "").trim();
        date = m.envelope?.date ? new Date(m.envelope.date).toISOString() : "";
      }
      let text = "";
      const dl = await client.download(String(uid), "1", { uid: true }).catch(() => null);
      if (dl?.content) {
        const chunks: Buffer[] = [];
        for await (const c of dl.content) chunks.push(c as Buffer);
        text = cleanEmailText(Buffer.concat(chunks).toString("utf8"));
      }
      out.push({ direction, subject, date, text });
    }
  } finally {
    lock.release();
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artistId")?.trim();
  if (!artistId) return NextResponse.json({ error: "artistId required" }, { status: 400 });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return NextResponse.json({ error: "GMAIL not configured" }, { status: 500 });

  const contacts = await pool.query<{ value: string }>(
    `SELECT DISTINCT LOWER(TRIM(value)) AS value FROM artist_contacts
     WHERE artist_beatport_id = $1 AND type = 'email'`,
    [artistId]
  );
  const emails = contacts.rows.map((r) => r.value);
  if (emails.length === 0) return NextResponse.json({ ok: true, messages: [] });

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  const messages: DialogMessage[] = [];
  try {
    await client.connect();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3);
    const boxes = await client.list();
    const sentBox = boxes.find((b) => b.specialUse === "\\Sent")?.path;
    for (const email of emails) {
      await collect(client, "INBOX", { from: email, since }, "in", messages);
      if (sentBox) await collect(client, sentBox, { to: email, since }, "out", messages);
    }
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch { /* closed */ }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  messages.sort((a, b) => (a.date < b.date ? -1 : 1));
  return NextResponse.json({ ok: true, messages });
}
