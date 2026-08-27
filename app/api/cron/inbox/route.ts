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
import { draftReplyAssist } from "@/lib/llm";
import { classifyEmail } from "@/lib/enrichClassify";
import { acquireLease } from "@/lib/cronLock";

/** Role from the text right before the email ("Bookings: x@y") or from the address itself. */
function detectRole(body: string, email: string, artistName: string | null): string {
  const idx = body.toLowerCase().indexOf(email);
  const before = idx > 0 ? body.slice(Math.max(0, idx - 48), idx).toLowerCase() : "";
  if (/booking/.test(before)) return "booking";
  if (/manag|mgmt/.test(before)) return "management";
  if (/paperwork|admin|account|invoice|advanc/.test(before)) return "generic";
  if (/press|promo/.test(before)) return "booking";
  return classifyEmail(email, artistName ?? "").type;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOOKBACK_DAYS = 3;
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|mail delivery (subsystem|system))/i;
const EMAIL_IN_BODY_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Auto-responders and system mail — not a real human reply. */
const AUTO_REPLY_SUBJECT_RE = /^(automatic reply|auto.?reply|autosvar|out of office|ooo[:\s]|abwesenheit|réponse automatique|respuesta automática|delivery status|undeliverable|vacation|slight delay|delay(ed)? (in )?respon|email acknowledgement|thank you for (your email|contacting|reaching out))/i;
/** Auto-responder phrasing inside the body (subject often looks like a normal Re:). */
const AUTO_REPLY_BODY_RE = /(this is an auto.?respon|expect a (slight )?delay|delay in (my )?respon|out of (the )?office|currently (traveling|travelling|on tour|away|on holiday|on vacation)|in the [A-Z]{2,4} time ?zone|limited access to (my )?email|will (get back|respond|reply) to you (as soon as|when|upon)|автоматична відповідь|автоответчик)/i;
const TECHNICAL_SENDER_RE = /(no-?reply|do-?not-?reply|noreply|notifications?@|newsletter@|updates@|support@.*\.(zendesk|freshdesk|intercom)\.|calendar-notification|drive-shares|@docs\.google\.com|@calendar\.google\.com)/i;
/** Statuses that a reply upgrades to Responded. */
const REPLYABLE = ["Attempt 1", "Attempt 2", "No Response", "Contacted", "Cold"];
const REPLY_EXCERPT_CHARS = 700;
/** Opt-out / rejection / negative context → lead is closed and email is blacklisted. */
const OPT_OUT_RE = /(not interested|no,? thanks?|not for me|stop (emailing|contacting|sending|spamming)|unsubscribe|remove (me|us)|take (me|us) off|don'?t (contact|email|write|message)|no longer interested|leave (me|us) alone|stop spam|this is spam|how did you get my|delete my (data|email|info)|gdpr request|fuck (off|you)|piss off|never (email|contact) (me|us)|report(ing)? (you|this)|не цікаво|не интересно|nicht interessiert|kein interesse|no me interesa|pas intéressé)/i;

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

  // Runs every 5 min — a lease keeps overlapping ticks from doing IMAP+LLM twice.
  // (Dedup on the reply-insert already prevents double notifications; this just
  // saves the wasted work of two concurrent scans.)
  if (!(await acquireLease("inbox", 4))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  let bouncedMarked = 0;
  let replies = 0;
  let snoozed = 0;
  let harvested = 0;
  const replyFrom: { addr: string; subject: string; uid: number; messageId: string; threaded: boolean }[] = [];
  const autoReplies: { addr: string; uid: number }[] = [];
  const bounceUids: number[] = [];
  const junkUids: number[] = []; // bounce notices + own [TEST] mail → moved to Trash after processing
  let trashed = 0;

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
          junkUids.push(msg.uid); // non-delivery notice — clutter once processed
        } else if (fromAddr === user.toLowerCase() || TECHNICAL_SENDER_RE.test(fromAddr)) {
          // own mail / technical senders — ignore; sweep our own [TEST] review mails
          if (/^\[test\b/i.test(subject.trim())) junkUids.push(msg.uid);
        } else if (AUTO_REPLY_SUBJECT_RE.test(subject.trim())) {
          autoReplies.push({ addr: fromAddr, uid: msg.uid }); // OOO etc. — snooze, harvest contacts
        } else if (Boolean(msg.envelope?.inReplyTo) || /^re:/i.test(subject.trim())) {
          // A genuine reply to us: threaded (In-Reply-To) OR any "Re:" subject.
          // We deliberately do NOT filter by keyword anymore — that dropped
          // replies to SoundCloud/Spotify outreach whose subjects don't mention
          // Beatport. Bounces / auto-replies / technical senders are already
          // filtered above. `threaded` lets us surface even replies from an
          // address we never contacted (see the unmatched-reply fallback below).
          replyFrom.push({ addr: fromAddr, subject, uid: msg.uid, messageId: msg.envelope?.messageId ?? "", threaded: Boolean(msg.envelope?.inReplyTo) });
        }
      }

      // Auto-responder (out of office): postpone the next touch by 5 days so we
      // don't follow up into an empty inbox
      if (autoReplies.length > 0) {
        const addrs = [...new Set(autoReplies.map((a) => a.addr))];
        const res = await pool.query(
          `UPDATE lead_profiles lp SET updated_at = now() + interval '5 days'
           FROM artist_contacts ac
           WHERE ac.artist_beatport_id = lp.artist_beatport_id AND ac.type = 'email'
             AND LOWER(TRIM(ac.value)) = ANY($1::text[])
             AND lp.status IN ('Attempt 1', 'Attempt 2')
             AND lp.updated_at < now() + interval '4 days'`,
          [addrs]
        ).catch(() => ({ rowCount: 0 }));
        snoozed = res.rowCount ?? 0;
        if (snoozed > 0) console.log(`[cron/inbox] snoozed follow-ups for ${snoozed} lead(s) (auto-reply/OOO)`);

        // Harvest extra contacts from OOO bodies ("for urgent: booking@...") —
        // agencies often list real booking/management addresses there
        const knownMap = new Map<string, { artist: string; name: string | null }>();
        const known = await pool.query<{ email: string; artist_beatport_id: string; artist_name: string | null }>(
          `SELECT DISTINCT LOWER(TRIM(ac.value)) AS email, ac.artist_beatport_id, am.artist_name
           FROM artist_contacts ac
           LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
           WHERE ac.type = 'email' AND LOWER(TRIM(ac.value)) = ANY($1::text[])`,
          [addrs]
        ).catch(() => ({ rows: [] as { email: string; artist_beatport_id: string; artist_name: string | null }[] }));
        for (const r of known.rows) knownMap.set(r.email, { artist: r.artist_beatport_id, name: r.artist_name });

        for (const ar of autoReplies) {
          const lead = knownMap.get(ar.addr);
          if (!lead) continue;
          const body = await downloadText(client, ar.uid);
          if (!body) continue;
          const found = [...new Set(
            (body.match(EMAIL_IN_BODY_RE) ?? [])
              .map((e) => e.toLowerCase())
              .filter((e) => e !== ar.addr && e !== user.toLowerCase() && !e.includes("googlemail.com"))
          )].slice(0, 4);
          if (found.length === 0) continue;
          // Notify only about genuinely NEW addresses (DO NOTHING + rowCount),
          // otherwise the same OOO in the 3-day window spams every hour
          const fresh: string[] = [];
          for (const newEmail of found) {
            const role = detectRole(body.toLowerCase(), newEmail, lead.name);
            const ins = await pool.query(
              `INSERT INTO artist_contacts (artist_beatport_id, type, value, confidence, status, email_type, source_context)
               VALUES ($1, 'email', $2, 0.8, 'ok', $3, 'auto-reply harvest')
               ON CONFLICT (artist_beatport_id, type, LOWER(TRIM(value))) DO NOTHING`,
              [lead.artist, newEmail, role]
            ).catch(() => ({ rowCount: 0 }));
            if ((ins.rowCount ?? 0) > 0) fresh.push(`${newEmail} (${role})`);
          }
          if (fresh.length === 0) continue;
          harvested += fresh.length;
          await sendTelegramMessage(
            `📮 <b>${tgEscape(lead.name ?? lead.artist)}</b>: в автовідповіді знайшов контакти — ${fresh.map(tgEscape).join(", ")} (додав до ліда)`
          );
          console.log(`[cron/inbox] harvested ${fresh.length} new contact(s) from OOO for ${lead.artist}`);
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
          // SC leads: a bounce also drops them out of the outreach sequence.
          await pool.query(`UPDATE sc_artists SET lead_status='Bounced', updated_at=now() WHERE LOWER(email)=$1 AND lead_status='Contacted'`, [email]).catch(() => {});
          await pool.query(`UPDATE spotify_leads SET lead_status='Bounced', email_status='bounced', updated_at=now() WHERE LOWER(email)=$1 AND lead_status='Contacted'`, [email]).catch(() => {});
        }
      }

      // Auto-clean: move processed junk (non-delivery notices + our own [TEST]
      // review mails) to Trash so the inbox stays clean. Reversible — Gmail keeps
      // Trash 30 days; we never expunge/hard-delete. Toggle: app_settings
      // 'inbox_autoclean'='0' turns it off.
      if (junkUids.length > 0) {
        const autoclean = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='inbox_autoclean'`)
          .then((r) => r.rows[0]?.value ?? "1").catch(() => "1");
        if (autoclean !== "0") {
          const boxes = await client.list().catch(() => []);
          const trash = boxes.find((b) => b.specialUse === "\\Trash")?.path || "[Gmail]/Trash";
          const uniqueJunk = [...new Set(junkUids)];
          const moved = await client.messageMove(uniqueJunk, trash, { uid: true }).catch(() => null);
          if (moved) trashed = uniqueJunk.length;
        }
      }

      // Pass 3: match reply senders against known lead contacts (IMAP still open
      // so we can download the reply body for the notification)
      if (replyFrom.length > 0) {
        const subjectByAddr = new Map(replyFrom.map((r) => [r.addr, r.subject]));
        const uidByAddr = new Map(replyFrom.map((r) => [r.addr, r.uid]));
        // Newest inbound Message-ID per address (fetch order is oldest→newest, so
        // Map.set keeps the latest).
        const msgIdByAddr = new Map(replyFrom.map((r) => [r.addr, r.messageId]));
        const unique = [...subjectByAddr.keys()];

        // Per-message dedup: notify once per distinct inbound Message-ID so a
        // lead's 2nd/3rd reply surfaces too (we re-scan the last 3 days every
        // run). Returns true only the first time we see this message. Falls back
        // to addr+subject+uid when the header is missing. Fail-open on DB error
        // so a real new reply is never silently dropped.
        const claimInbound = async (addr: string): Promise<boolean> => {
          const mid = (msgIdByAddr.get(addr) || `${addr}:${subjectByAddr.get(addr) ?? ""}:${uidByAddr.get(addr) ?? ""}`).slice(0, 500);
          const ins = await pool
            .query(`INSERT INTO notified_replies (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING`, [mid])
            .catch((e) => { console.error("[cron/inbox] notified_replies dedup failed (fail-open):", e instanceof Error ? e.message : e); return { rowCount: 1 }; });
          return (ins.rowCount ?? 0) > 0;
        };

        // Shared reply notifier for SC/Spotify/Radar: download the reply, draft a
        // contextual response with Claude, send it to Telegram WITH an "Approve &
        // Send" button, and store the draft in tg_notifications so the button (or
        // a swipe-reply edit) can send it back to the artist.
        // Concrete offer per channel, read from app_settings (offer_<ch>_name /
        // _url / _code) so the exact product + link + discount code are editable
        // without a deploy. Cached per run.
        const offerCache = new Map<string, { name: string; url: string | null; code: string | null } | null>();
        const getOffer = async (source: string) => {
          const s = source.toLowerCase();
          const ch = s.startsWith("beatport") ? "beatport" : s.startsWith("soundcloud") ? "soundcloud"
            : s.startsWith("spotify") ? "spotify" : s.startsWith("radar") ? "radar" : null;
          if (!ch) return undefined;
          if (!offerCache.has(ch)) {
            const rows = await pool.query<{ key: string; value: string }>(
              `SELECT key, value FROM app_settings WHERE key IN ($1,$2,$3)`,
              [`offer_${ch}_name`, `offer_${ch}_url`, `offer_${ch}_code`]
            ).then((r) => r.rows).catch(() => [] as { key: string; value: string }[]);
            const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
            offerCache.set(ch, m[`offer_${ch}_name`]
              ? { name: m[`offer_${ch}_name`], url: m[`offer_${ch}_url`] || null, code: m[`offer_${ch}_code`] || null }
              : null);
          }
          return offerCache.get(ch) ?? undefined;
        };

        const notifyReply = async (o: { email: string; name: string | null; source: string; beatportId?: string | null }) => {
          const addr = o.email.toLowerCase().trim();
          const uid = uidByAddr.get(addr);
          const excerpt = uid ? await downloadText(client, uid) : null;
          const subject = subjectByAddr.get(addr) || null;
          const draft = excerpt ? await draftReplyAssist(excerpt, { name: o.name, channel: o.source, offer: await getOffer(o.source) }) : null;
          const activate = o.source.startsWith("Beatport") ? " (лід — активуй)" : "";
          const msgId = await sendTelegramMessage(
            `💬 <b>${o.source}</b>-відповідь${activate} від <b>${o.name || o.email}</b>\n${o.email}` +
            (excerpt ? `\n\n<blockquote>${tgEscape(excerpt.slice(0, 400))}</blockquote>` : "") +
            (draft
              ? `\n💡 <b>Чернетка (${draft.intent})</b>:\n<code>${tgEscape(draft.reply)}</code>\n\n✅ <b>Approve &amp; Send</b> — надіслати як є.\n✏️ <b>Редагувати</b> — напишеш свій варіант, я відправлю.`
              : `\n↩️ <i>Свайп-reply — напиши відповідь артисту.</i>`),
            draft ? [[{ text: "✅ Approve & Send", callback_data: "approve" }, { text: "✏️ Редагувати", callback_data: "edit" }]] : undefined
          );
          if (msgId != null) {
            await pool.query(
              `INSERT INTO tg_notifications (tg_message_id, artist_beatport_id, artist_name, email, subject, draft, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tg_message_id) DO NOTHING`,
              [msgId, o.beatportId ?? null, o.name, o.email, subject, draft?.reply ?? null, o.source]
            ).catch(() => {});
          }
        };
        const matched = await pool.query<{ artist_beatport_id: string; value: string; artist_name: string | null }>(
          `SELECT DISTINCT ac.artist_beatport_id, ac.value, am.artist_name
           FROM artist_contacts ac
           JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
           LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
           WHERE ac.type = 'email' AND LOWER(TRIM(ac.value)) = ANY($1::text[])
             AND COALESCE(lp.status,'New') NOT IN ('Not Interested','Bounced','Unsubscribed')`,
          [unique]
        );

        // SC leads: notify on EVERY new inbound (claimInbound dedups per message),
        // not just the first reply, so the whole conversation lives in Telegram.
        // Skip only leads that opted out / bounced.
        const scRows = await pool.query<{ username: string; full_name: string | null; email: string }>(
          `SELECT username, full_name, email FROM sc_artists
           WHERE LOWER(email) = ANY($1::text[]) AND COALESCE(lead_status,'') NOT IN ('Not Interested','Unsubscribed','Bounced')`, [unique]
        ).then((r) => r.rows).catch(() => [] as { username: string; full_name: string | null; email: string }[]);
        for (const row of scRows) {
          if (!(await claimInbound(row.email.toLowerCase().trim()))) continue;
          replies++;
          await pool.query(`UPDATE sc_artists SET lead_status='Responded', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [row.email]).catch(() => {});
          await notifyReply({ email: row.email, name: row.full_name || row.username, source: "SoundCloud" });
        }

        // Spotify leads: same every-reply behaviour.
        const spRows = await pool.query<{ ig_username: string; full_name: string | null; email: string }>(
          `SELECT ig_username, full_name, email FROM spotify_leads
           WHERE LOWER(email) = ANY($1::text[]) AND COALESCE(lead_status,'') NOT IN ('Not Interested','Unsubscribed','Bounced')`, [unique]
        ).then((r) => r.rows).catch(() => [] as { ig_username: string; full_name: string | null; email: string }[]);
        for (const row of spRows) {
          if (!(await claimInbound(row.email.toLowerCase().trim()))) continue;
          replies++;
          await pool.query(`UPDATE spotify_leads SET lead_status='Responded', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [row.email]).catch(() => {});
          await notifyReply({ email: row.email, name: row.full_name || row.ig_username, source: "Spotify" });
        }

        // Radar leads (YouTube/Reddit/…): same every-reply behaviour, source tagged.
        const radarRows = await pool.query<{ name: string | null; email: string; source: string }>(
          `SELECT name, email, source FROM radar_leads
           WHERE LOWER(email) = ANY($1::text[]) AND COALESCE(status,'') NOT IN ('not_interested','unsubscribed','bounced')`, [unique]
        ).then((r) => r.rows).catch(() => [] as { name: string | null; email: string; source: string }[]);
        for (const row of radarRows) {
          if (!(await claimInbound(row.email.toLowerCase().trim()))) continue;
          replies++;
          await pool.query(`UPDATE radar_leads SET status='responded', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [row.email]).catch(() => {});
          await notifyReply({ email: row.email, name: row.name, source: `Radar/${row.source}` });
        }

        for (const row of matched.rows) {
          const addrKey = row.value.toLowerCase().trim();
          // Per-message dedup (not status): every reply from the lead surfaces,
          // so the whole back-and-forth lives in Telegram.
          if (!(await claimInbound(addrKey))) continue;
          await pool.query(
            `UPDATE lead_profiles SET status = 'Responded', updated_at = now()
             WHERE artist_beatport_id = $1 AND status = ANY($2::text[])`,
            [row.artist_beatport_id, REPLYABLE]
          ).catch(() => {});
          await pool.query(
            `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
             VALUES ($1, 'reply', 'email', $2, now(), 'replied')`,
            [row.artist_beatport_id, row.value]
          ).catch(() => {});
          replies++;
          console.log(`[cron/inbox] reply detected from ${row.value} (artist ${row.artist_beatport_id})`);

          const name = row.artist_name ?? row.artist_beatport_id;
          const subject = subjectByAddr.get(addrKey) ?? "";
          const uid = uidByAddr.get(addrKey);
          const excerpt = uid ? await downloadText(client, uid) : null;

          // Body-level auto-responder ("slight delay", "this is an autoresponder"):
          // not a real reply — revert the status transition, snooze follow-ups, no TG
          if (excerpt && AUTO_REPLY_BODY_RE.test(excerpt)) {
            // "No longer monitored, write to X" — harvest the redirect address
            if (/(no longer (monitored|in use|active|checked)|direct (all )?(future )?correspondence|please (contact|email|write to|reach))/i.test(excerpt)) {
              const redirects = (excerpt.match(EMAIL_IN_BODY_RE) ?? [])
                .map((e) => e.toLowerCase())
                .filter((e) => e !== addrKey && e !== user.toLowerCase());
              for (const newEmail of redirects.slice(0, 2)) {
                const ins = await pool.query(
                  `INSERT INTO artist_contacts (artist_beatport_id, type, value, confidence, status, source_context)
                   VALUES ($1, 'email', $2, 0.9, 'ok', 'auto-reply redirect')
                   ON CONFLICT (artist_beatport_id, type, LOWER(TRIM(value))) DO NOTHING`,
                  [row.artist_beatport_id, newEmail]
                ).catch(() => ({ rowCount: 0 }));
                if ((ins.rowCount ?? 0) === 0) continue; // already known — no re-notification
                await invalidateContactEmail(row.value, "auto-reply: address no longer monitored");
                await sendTelegramMessage(
                  `📮 <b>${tgEscape(name)}</b>: стара адреса не моніториться, знайшов нову в автовідповіді → <b>${tgEscape(newEmail)}</b> (додав до ліда)`
                );
                console.log(`[cron/inbox] redirect harvested for ${row.artist_beatport_id}: ${newEmail}`);
              }
            }
            await pool.query(
              `UPDATE lead_profiles SET status = 'No Response', updated_at = now() + interval '5 days'
               WHERE artist_beatport_id = $1 AND status = 'Responded'`,
              [row.artist_beatport_id]
            );
            await pool.query(
              `DELETE FROM outreach_events WHERE artist_beatport_id = $1 AND template_id = 'reply' AND sent_at > now() - interval '5 minutes'`,
              [row.artist_beatport_id]
            ).catch(() => {});
            replies--;
            console.log(`[cron/inbox] body auto-reply from ${row.value} — skipped, follow-ups snoozed`);
            continue;
          }

          // Opt-out: close the lead, blacklist the email everywhere, notify differently
          if (excerpt && OPT_OUT_RE.test(excerpt)) {
            await pool.query(
              `UPDATE lead_profiles SET status = 'Not Interested', updated_at = now() WHERE artist_beatport_id = $1`,
              [row.artist_beatport_id]
            );
            await pool.query(
              `INSERT INTO email_blacklist (email, reason) VALUES (LOWER(TRIM($1)), 'opt-out (auto-detected)')
               ON CONFLICT (email) DO NOTHING`,
              [row.value]
            ).catch(() => {});
            await sendTelegramMessage(
              `🚫 <b>Лід відмовився</b>\n\n🎧 <b>${tgEscape(name)}</b>\n📧 ${tgEscape(row.value)}\n` +
              (excerpt ? `\n<blockquote>${tgEscape(excerpt.slice(0, 300))}</blockquote>\n` : "") +
              `\nСтатус → Not Interested, email у blacklist — більше не турбуємо.`
            );
            continue;
          }

          const bpDraft = excerpt ? await draftReplyAssist(excerpt, { name, channel: "Beatport", offer: await getOffer("Beatport") }) : null;
          const tgMessageId = await sendTelegramMessage(
            `🎉 <b>Відповідь від ліда! (Beatport — активуй)</b>\n\n` +
            `🎧 <b>${tgEscape(name)}</b>\n` +
            `📧 ${tgEscape(row.value)}\n` +
            (subject ? `✉️ ${tgEscape(subject)}\n` : "") +
            (excerpt ? `\n<blockquote>${tgEscape(excerpt)}</blockquote>\n` : "") +
            (bpDraft ? `\n💡 <b>Чернетка (${bpDraft.intent})</b>:\n<code>${tgEscape(bpDraft.reply)}</code>\n` : "") +
            `\n✅ <b>Approve &amp; Send</b> — як є · ✏️ <b>Редагувати</b> — свій варіант.\n` +
            `<a href="https://ninja-digger.vercel.app/artist/${encodeURIComponent(row.artist_beatport_id)}">Відкрити картку ліда</a>`,
            bpDraft ? [[{ text: "✅ Approve & Send", callback_data: "approve" }, { text: "✏️ Редагувати", callback_data: "edit" }]] : undefined
          );
          if (tgMessageId != null) {
            await pool.query(
              `INSERT INTO tg_notifications (tg_message_id, artist_beatport_id, artist_name, email, subject, draft, source)
               VALUES ($1, $2, $3, $4, $5, $6, 'Beatport')
               ON CONFLICT (tg_message_id) DO NOTHING`,
              [tgMessageId, row.artist_beatport_id, row.artist_name, row.value, subject || null, bpDraft?.reply ?? null]
            ).catch((e) => console.error("[cron/inbox] tg_notifications insert failed:", e instanceof Error ? e.message : e));
          }
        }

        // "ALWAYS to Telegram" guarantee: any threaded reply we did NOT already
        // surface above (sender doesn't match a known lead, or they replied from
        // a different address) is still forwarded, so no reply is ever missed —
        // whether it's their 1st or 10th. claimInbound keeps it to once.
        for (const rf of replyFrom) {
          if (!rf.threaded) continue;
          if (!(await claimInbound(rf.addr))) continue; // already surfaced
          replies++;
          console.log(`[cron/inbox] unmatched reply forwarded from ${rf.addr}`);
          await notifyReply({ email: rf.addr, name: null, source: "Пошта" });
        }
      }
    } finally {
      lock.release();
    }

    // Sent sweep: a manual thread-reply from us (In-Reply-To present) means a
    // live conversation — move the lead to 'In Progress'. Automated touches
    // carry no In-Reply-To, so they never match.
    try {
      const boxes = await client.list();
      const sentBox = boxes.find((b) => b.specialUse === "\\Sent")?.path;
      if (sentBox) {
        const sentLock = await client.getMailboxLock(sentBox);
        const repliedTo = new Set<string>();
        try {
          const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3);
          for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
            if (!msg.envelope?.inReplyTo) continue;
            for (const a of [...(msg.envelope?.to ?? []), ...(msg.envelope?.cc ?? [])]) {
              const addr = a.address?.toLowerCase();
              if (addr && addr !== user.toLowerCase()) repliedTo.add(addr);
            }
          }
        } finally {
          sentLock.release();
        }
        if (repliedTo.size > 0) {
          await pool.query(
            `UPDATE lead_profiles lp SET status = 'In Progress', updated_at = now()
             FROM artist_contacts ac
             WHERE ac.artist_beatport_id = lp.artist_beatport_id AND ac.type = 'email'
               AND LOWER(TRIM(ac.value)) = ANY($1::text[])
               AND lp.status NOT IN ('Won', 'Not Interested', 'Blacklist', 'In Progress')`,
            [[...repliedTo]]
          ).catch((e) => console.error("[cron/inbox] sent-sweep update failed:", e instanceof Error ? e.message : e));
        }
      }
    } catch (e) {
      console.error("[cron/inbox] sent sweep failed:", e instanceof Error ? e.message : e);
    }

    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch { /* already closed */ }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: { bounceMessages: bounceUids.length, inboxSenders: replyFrom.length, autoReplies: autoReplies.length },
    bouncedMarked,
    replies,
    snoozed,
    harvested,
    trashed,
    ts: new Date().toISOString(),
  });
}
