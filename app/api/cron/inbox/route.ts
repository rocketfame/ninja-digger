/**
 * GET /api/cron/inbox — hourly inbox scan (Gmail IMAP):
 * 1. Bounce handling: mailer-daemon messages → extract failed recipients →
 *    mark artist_contacts status='bounced' (excluded from all future sends).
 * 2. Reply detection: sender matches a known lead contact → lead_profiles
 *    status='Responded' + outreach_event 'replied' + Telegram notification
 *    with the reply text. The TG message is stored in tg_notifications so a
 *    Telegram swipe-reply can be routed back to the artist as an email.
 */

import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { pool } from "@/lib/db";
import { invalidateContactEmail } from "@/lib/emailHygiene";
import { sendTelegramMessage, tgEscape } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LOOKBACK_DAYS = 3;
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|mail delivery (subsystem|system))/i;
const EMAIL_IN_BODY_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Auto-responders and system mail — not a real human reply. */
const AUTO_REPLY_SUBJECT_RE = /^(automatic reply|auto.?reply|autosvar|out of office|ooo[:\s]|abwesenheit|réponse automatique|respuesta automática|delivery status|undeliverable|vacation)/i;
const TECHNICAL_SENDER_RE = /(no-?reply|do-?not-?reply|noreply|notifications?@|newsletter@|updates@|support@.*\.(zendesk|freshdesk|intercom)\.|calendar-notification|drive-shares|@docs\.google\.com|@calendar\.google\.com)/i;
/** Statuses that a reply upgrades to Responded. */
const REPLYABLE = ["Attempt 1", "Attempt 2", "No Response", "Contacted", "Cold"];
const REPLY_EXCERPT_CHARS = 700;

async function downloadText(client: ImapFlow, uid: number): Promise<string | null> {
  // Part "1" is the first MIME part (usually text/plain); fall back to full text
  for (const part of ["1", "TEXT"]) {
    const dl = await client.download(String(uid), part, { uid: true }).catch(() => null);
    if (!dl?.content) continue;
    const chunks: Buffer[] = [];
    for await (const chunk of dl.content) chunks.push(chunk as Buffer);
    let text = Buffer.concat(chunks).toString("utf8");
    // Quoted-printable artifacts and HTML fallback cleanup
    text = text
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, h) => { try { return Buffer.from(h, "hex").toString("utf8"); } catch { return ""; } })
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // Cut quoted original message ("On ... wrote:" / "> ")
    const quoteIdx = text.search(/\nOn .{5,80} wrote:|\n>{1,2} /);
    if (quoteIdx > 40) text = text.slice(0, quoteIdx).trim();
    if (text.length > 0) return text.slice(0, REPLY_EXCERPT_CHARS);
  }
  return null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return NextResponse.json({ ok: false, error: "GMAIL not configured" });

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  let bouncedMarked = 0;
  let replies = 0;
  const replyFrom: { addr: string; subject: string; uid: number }[] = [];
  const bounceUids: number[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3);

      // Pass 1: envelopes only — split into bounce notifications and potential replies.
      // Auto-responders and technical senders are dropped here.
      for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
        const fromName = msg.envelope?.from?.[0]?.name ?? "";
        const subject = msg.envelope?.subject ?? "";
        if (!fromAddr) continue;
        if (BOUNCE_FROM_RE.test(fromAddr) || BOUNCE_FROM_RE.test(fromName)) {
          bounceUids.push(msg.uid);
        } else if (
          fromAddr !== user.toLowerCase() &&
          !TECHNICAL_SENDER_RE.test(fromAddr) &&
          !AUTO_REPLY_SUBJECT_RE.test(subject.trim())
        ) {
          replyFrom.push({ addr: fromAddr, subject, uid: msg.uid });
        }
      }

      // Pass 2: bounce bodies → failed recipient addresses
      for (const uid of bounceUids) {
        const dl = await client.download(String(uid), undefined, { uid: true }).catch(() => null);
        if (!dl?.content) continue;
        const chunks: Buffer[] = [];
        for await (const chunk of dl.content) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString("utf8").slice(0, 50_000);
        const found = new Set(
          (body.match(EMAIL_IN_BODY_RE) ?? [])
            .map((e) => e.toLowerCase())
            .filter((e) => e !== user.toLowerCase() && !BOUNCE_FROM_RE.test(e) && !e.includes("googlemail.com") && !e.includes("google.com"))
        );
        for (const email of found) {
          bouncedMarked += await invalidateContactEmail(email, "async bounce (mailer-daemon)");
        }
      }

      // Pass 3: match reply senders against known lead contacts (IMAP still open
      // so we can download the reply body for the notification)
      if (replyFrom.length > 0) {
        const subjectByAddr = new Map(replyFrom.map((r) => [r.addr, r.subject]));
        const uidByAddr = new Map(replyFrom.map((r) => [r.addr, r.uid]));
        const unique = [...subjectByAddr.keys()];
        const matched = await pool.query<{ artist_beatport_id: string; value: string; artist_name: string | null }>(
          `SELECT DISTINCT ac.artist_beatport_id, ac.value, am.artist_name
           FROM artist_contacts ac
           JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
           LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
           WHERE ac.type = 'email' AND LOWER(TRIM(ac.value)) = ANY($1::text[])
             AND lp.status = ANY($2::text[])`,
          [unique, REPLYABLE]
        );
        for (const row of matched.rows) {
          // The status transition is the dedup: once Responded, no re-notification
          const updated = await pool.query(
            `UPDATE lead_profiles SET status = 'Responded', updated_at = now()
             WHERE artist_beatport_id = $1 AND status = ANY($2::text[])`,
            [row.artist_beatport_id, REPLYABLE]
          );
          if ((updated.rowCount ?? 0) === 0) continue;
          await pool.query(
            `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
             VALUES ($1, 'reply', 'email', $2, now(), 'replied')`,
            [row.artist_beatport_id, row.value]
          ).catch(() => {});
          replies++;
          console.log(`[cron/inbox] reply detected from ${row.value} (artist ${row.artist_beatport_id})`);

          const addrKey = row.value.toLowerCase().trim();
          const name = row.artist_name ?? row.artist_beatport_id;
          const subject = subjectByAddr.get(addrKey) ?? "";
          const uid = uidByAddr.get(addrKey);
          const excerpt = uid ? await downloadText(client, uid) : null;

          const tgMessageId = await sendTelegramMessage(
            `🎉 <b>Відповідь від ліда!</b>\n\n` +
            `🎧 <b>${tgEscape(name)}</b>\n` +
            `📧 ${tgEscape(row.value)}\n` +
            (subject ? `✉️ ${tgEscape(subject)}\n` : "") +
            (excerpt ? `\n<blockquote>${tgEscape(excerpt)}</blockquote>\n` : "") +
            `\n↩️ <i>Зроби reply на це повідомлення — я надішлю твій текст артисту на email.</i>\n` +
            `<a href="https://ninja-digger.vercel.app/artist/${encodeURIComponent(row.artist_beatport_id)}">Відкрити картку ліда</a>`
          );
          if (tgMessageId != null) {
            await pool.query(
              `INSERT INTO tg_notifications (tg_message_id, artist_beatport_id, artist_name, email, subject)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (tg_message_id) DO NOTHING`,
              [tgMessageId, row.artist_beatport_id, row.artist_name, row.value, subject || null]
            ).catch((e) => console.error("[cron/inbox] tg_notifications insert failed:", e instanceof Error ? e.message : e));
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch { /* already closed */ }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: { bounceMessages: bounceUids.length, inboxSenders: replyFrom.length },
    bouncedMarked,
    replies,
    ts: new Date().toISOString(),
  });
}
