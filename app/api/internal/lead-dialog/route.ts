/**
 * GET /api/internal/lead-dialog?artistId=... — full email conversation with a
 * lead (INBOX = their messages, Sent = ours), sorted by date.
 * Speed: 15-min DB cache (url_cache) + two parallel IMAP connections +
 * batched envelope fetches. ?fresh=1 bypasses the cache.
 */

import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { pool } from "@/lib/db";
import { cleanEmailText } from "@/lib/emailText";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_DAYS = 180;
const MAX_PER_DIRECTION = 8;
const CACHE_TTL_S = 900;

type DialogMessage = { direction: "in" | "out"; subject: string; date: string; text: string };

function makeClient(user: string, pass: string) {
  return new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
}

/** Collect messages from one mailbox over its own connection. */
async function collectBox(
  user: string,
  pass: string,
  useSent: boolean,
  emails: string[],
  direction: "in" | "out"
): Promise<DialogMessage[]> {
  const client = makeClient(user, pass);
  const out: DialogMessage[] = [];
  try {
    await client.connect();
    let mailbox = "INBOX";
    if (useSent) {
      const boxes = await client.list();
      mailbox = boxes.find((b) => b.specialUse === "\\Sent")?.path ?? "[Gmail]/Sent Mail";
    }
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3);
      let uids: number[] = [];
      for (const email of emails) {
        const criteria = useSent ? { to: email, since } : { from: email, since };
        const found = ((await client.search(criteria, { uid: true }).catch(() => [])) || []).slice(-MAX_PER_DIRECTION);
        uids = uids.concat(found);
      }
      if (uids.length === 0) return out;
      // One batched fetch for all envelopes
      const meta = new Map<number, { subject: string; date: string }>();
      for await (const m of client.fetch(uids.join(","), { envelope: true, uid: true }, { uid: true })) {
        meta.set(m.uid, {
          subject: (m.envelope?.subject ?? "").trim(),
          date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : "",
        });
      }
      for (const uid of uids) {
        let text = "";
        const dl = await client.download(String(uid), "1", { uid: true }).catch(() => null);
        if (dl?.content) {
          const chunks: Buffer[] = [];
          for await (const c of dl.content) chunks.push(c as Buffer);
          text = cleanEmailText(Buffer.concat(chunks).toString("utf8"));
        }
        const m = meta.get(uid);
        out.push({ direction, subject: m?.subject ?? "", date: m?.date ?? "", text });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch {
    try { await client.logout(); } catch { /* closed */ }
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artistId")?.trim();
  const fresh = searchParams.get("fresh") === "1";
  if (!artistId) return NextResponse.json({ error: "artistId required" }, { status: 400 });

  const cacheKey = `dialog:${artistId}`;
  if (!fresh) {
    const cached = await pool.query<{ body: string }>(
      `SELECT body FROM url_cache WHERE url = $1 AND fetched_at > now() - ($2 || ' seconds')::interval`,
      [cacheKey, CACHE_TTL_S]
    ).catch(() => ({ rows: [] as { body: string }[] }));
    if (cached.rows[0]?.body) {
      return NextResponse.json({ ok: true, cached: true, messages: JSON.parse(cached.rows[0].body) });
    }
  }

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

  // INBOX and Sent in parallel over separate connections
  const [inbound, outbound] = await Promise.all([
    collectBox(user, pass, false, emails, "in"),
    collectBox(user, pass, true, emails, "out"),
  ]);
  const messages = [...inbound, ...outbound].sort((a, b) => (a.date < b.date ? -1 : 1));

  await pool.query(
    `INSERT INTO url_cache (url, body, fetched_at, ttl_seconds) VALUES ($1, $2, now(), $3)
     ON CONFLICT (url) DO UPDATE SET body = $2, fetched_at = now(), ttl_seconds = $3`,
    [cacheKey, JSON.stringify(messages), CACHE_TTL_S]
  ).catch(() => {});

  return NextResponse.json({ ok: true, messages });
}
