/**
 * GET /api/cron/inbox — hourly inbox scan (Gmail IMAP):
 * 1. Bounce handling: mailer-daemon messages → extract failed recipients →
 *    mark artist_contacts status='bounced' (excluded from all future sends).
 * 2. Reply detection: sender matches a known lead contact → lead_profiles
 *    status='Responded' + outreach_event outcome='replied'. Feeds the
 *    "Відповіли" / reply-rate metrics on the dashboard automatically.
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
  const replyFrom: { addr: string; subject: string }[] = [];
  const bounceUids: number[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3);

      // Pass 1: envelopes only — split into bounce notifications and potential replies.
      // Auto-responders and technical senders are dropped here: only mail that can
      // be a real human reply goes into the match list.
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
          replyFrom.push({ addr: fromAddr, subject });
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
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch { /* already closed */ }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Reply detection: match sender addresses against known lead contacts
  if (replyFrom.length > 0) {
    const subjectByAddr = new Map(replyFrom.map((r) => [r.addr, r.subject]));
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
      // The status transition is the dedup: once Responded, this lead can't match again
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
      const name = row.artist_name ?? row.artist_beatport_id;
      const subject = subjectByAddr.get(row.value.toLowerCase().trim()) ?? "";
      await sendTelegramMessage(
        `🎉 <b>Відповідь від ліда!</b>\n\n` +
        `🎧 <b>${tgEscape(name)}</b>\n` +
        `📧 ${tgEscape(row.value)}\n` +
        (subject ? `✉️ ${tgEscape(subject)}\n` : "") +
        `\n<a href="https://ninja-digger.vercel.app/artist/${encodeURIComponent(row.artist_beatport_id)}">Відкрити картку ліда</a>`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: { bounceMessages: bounceUids.length, inboxSenders: replyFrom.length },
    bouncedMarked,
    replies,
    ts: new Date().toISOString(),
  });
}
