/**
 * POST /api/telegram/webhook — Telegram bot updates.
 * Swipe-reply on a lead notification → the text is emailed to that artist
 * from GMAIL_USER, lead status → 'In Progress'.
 * Security: X-Telegram-Bot-Api-Secret-Token must match TELEGRAM_WEBHOOK_SECRET,
 * and only messages from TELEGRAM_CHAT_ID are accepted.
 */

import { NextResponse } from "next/server";
import * as nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { pool } from "@/lib/db";
import { sendTelegramMessage, sendForceReply, editMessageReplyMarkup, tgEscape, answerCallbackQuery, type InlineButton } from "@/lib/telegram";
import { buildStats, buildDailyReport, buildFullReport, buildScReport } from "@/lib/reports";
import { wrapEmailHtml, TEXT_SIGNATURE } from "@/lib/emailTemplate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TgUpdate = {
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number };
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id: number }; message_id?: number };
  };
};

const MENU_KEYBOARD: InlineButton[][] = [
  [{ text: "📋 Повний звіт (всі системи)", callback_data: "full" }],
  [{ text: "☁️ SoundCloud звіт", callback_data: "screport" }, { text: "💿 Beatport звіт", callback_data: "report" }],
  [{ text: "📊 Статус", callback_data: "stats" }, { text: "🎯 Черга", callback_data: "queue" }],
  [{ text: "⏸ Пауза", callback_data: "pause" }, { text: "▶️ Відновити", callback_data: "resume" }],
  [{ text: "🌐 Дашборд", url: "https://ninja-digger.vercel.app/" }],
  [{ text: "💿 Beatport", url: "https://ninja-digger.vercel.app/leads" }, { text: "☁️ SoundCloud", url: "https://ninja-digger.vercel.app/sc-leads" }],
];


async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value]
  );
}

async function handleCommand(cmd: string): Promise<void> {
  switch (cmd) {
    case "/start":
    case "/help":
    case "/menu":
      await sendTelegramMessage(
        `🥷 <b>Lead Digger — меню</b>\n\n` +
        `📬 <b>Як це працює:</b> коли артист відповість на наш лист — його повідомлення прийде сюди в чат.\n\n` +
        `✍️ <b>Щоб відповісти артисту:</b> свайпни його повідомлення вліво (звичайний Reply у Telegram), напиши текст — і я відправлю його артисту на пошту від імені Max.\n\n` +
        `🚫 Якщо артист пише "not interested" — я сам закрию його і більше не турбуватиму.\n` +
        `📈 Щоденний звіт приходить сам о 20:30.`,
        MENU_KEYBOARD
      );
      break;
    case "/stats":
      await sendTelegramMessage(await buildStats(), MENU_KEYBOARD);
      break;
    case "/report":
      await sendTelegramMessage(await buildDailyReport(), MENU_KEYBOARD);
      break;
    case "/full":
    case "/звіт":
      await sendTelegramMessage(await buildFullReport(), MENU_KEYBOARD);
      break;
    case "/screport":
      await sendTelegramMessage(await buildScReport(), MENU_KEYBOARD);
      break;
    case "/queue": {
      const next = await pool.query<{ name: string; segment: string | null }>(
        `SELECT t.name, t.segment FROM (
           SELECT DISTINCT ON (ac.artist_beatport_id) am.artist_name AS name, ls.segment, am.first_seen
           FROM artist_contacts ac
           JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
           LEFT JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id
           LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
           WHERE ac.type='email' AND ac.confidence>=0.65 AND (ac.status IS NULL OR ac.status='ok')
             AND (lp.status IS NULL OR lp.status='New') AND am.last_seen >= current_date - 14
             AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)
           ORDER BY ac.artist_beatport_id
         ) t
         ORDER BY CASE t.segment WHEN 'NEWCOMER' THEN 0 WHEN 'NEW_ENTRY' THEN 1 WHEN 'FAST_GROWING' THEN 2 ELSE 3 END,
           t.first_seen DESC NULLS LAST
         LIMIT 10`
      ).then((r) => r.rows).catch(() => []);
      await sendTelegramMessage(
        next.length === 0
          ? "Черга Touch 1 порожня — enrichment-крон шукає нові контакти щогодини."
          : `🎯 <b>Наступні в черзі Touch 1:</b>\n\n` +
            next.map((r, i) => `${i + 1}. ${tgEscape(r.name ?? "?")} <i>(${r.segment ?? "—"})</i>`).join("\n")
      );
      break;
    }
    case "/pause":
      await setSetting("outreach_paused", "1");
      await sendTelegramMessage("⏸ Розсилку поставлено на паузу. Відновити: /resume");
      break;
    case "/resume":
      await setSetting("outreach_paused", "0");
      await sendTelegramMessage("▶️ Розсилку відновлено — наступний запуск у найближчу годину (:00).");
      break;
    default:
      await sendTelegramMessage("Не знаю такої команди. /help — список команд.");
  }
}

/** Send an email to the artist from Max's Gmail, mark the lead In Progress, and
 * log the outbound event. Shared by Approve and Edit-send. Returns error text
 * on failure, null on success. */
async function sendArtistEmail(o: { email: string; subject: string | null; body: string; artistId: string | null }): Promise<string | null> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return "GMAIL не сконфігуровано";
  const subject = o.subject && o.subject.trim()
    ? (o.subject.trim().toLowerCase().startsWith("re:") ? o.subject.trim() : `Re: ${o.subject.trim()}`)
    : "Re: your message | PromoSound";
  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transporter.sendMail({
      from: `"Max from PromoSound" <${user}>`, to: o.email, subject,
      text: o.body + TEXT_SIGNATURE, html: wrapEmailHtml(o.body + "\n\nBest,\nMax"),
    });
    if (o.artistId) {
      await pool.query(`INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1,'In Progress',now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status='In Progress', updated_at=now()`, [o.artistId]).catch(() => {});
      await pool.query(`INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
         VALUES ($1,'tg_reply','email',$2, now(),'In Progress')`, [o.artistId, o.email]).catch(() => {});
    }
    await pool.query(`UPDATE sc_artists SET lead_status='In Progress', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [o.email]).catch(() => {});
    await pool.query(`UPDATE spotify_leads SET lead_status='In Progress', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [o.email]).catch(() => {});
    await pool.query(`UPDATE radar_leads SET status='responded', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [o.email]).catch(() => {});
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Approve button: send the stored Claude draft to the artist as-is, then strip
 * the button so the same draft can't be sent twice. */
async function handleApprove(msgId: number): Promise<void> {
  type Row = { artist_beatport_id: string | null; artist_name: string | null; email: string; subject: string | null; draft: string | null };
  const row = await pool.query<Row>(
    `SELECT artist_beatport_id, artist_name, email, subject, draft FROM tg_notifications WHERE tg_message_id = $1`, [msgId]
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!row) { await sendTelegramMessage("⚠️ Не знайшов цей лист у базі."); return; }
  if (!row.draft) { await sendTelegramMessage("✅ Цю чернетку вже надіслано (або її нема). Щоб написати вручну — свайп-reply."); return; }
  const err = await sendArtistEmail({ email: row.email, subject: row.subject, body: row.draft, artistId: row.artist_beatport_id });
  if (err) { await sendTelegramMessage(`❌ Не вдалось надіслати: ${tgEscape(err)}`); return; }
  // Consume the draft + remove the button → no accidental double-send.
  await pool.query(`UPDATE tg_notifications SET draft = NULL WHERE tg_message_id = $1`, [msgId]).catch(() => {});
  await editMessageReplyMarkup(msgId, []);
  await sendTelegramMessage(`✅ <b>Надіслано</b> → ${tgEscape(row.artist_name ?? row.email)}\n📧 ${tgEscape(row.email)}\nСтатус ліда → In Progress`);
}

/** Edit button: pop a force-reply prompt so the user types their own version
 * without swiping. The prompt is mapped to the same lead so the reply handler
 * routes it as the outgoing email. */
async function handleEdit(msgId: number): Promise<void> {
  type Row = { artist_beatport_id: string | null; artist_name: string | null; email: string; subject: string | null; draft: string | null };
  const row = await pool.query<Row>(
    `SELECT artist_beatport_id, artist_name, email, subject, draft FROM tg_notifications WHERE tg_message_id = $1`, [msgId]
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!row) { await sendTelegramMessage("⚠️ Не знайшов ліда для редагування."); return; }
  // Telegram bots can't pre-fill the input box, so ship the current draft as a
  // tap-to-copy block right in the force-reply prompt: tap → paste → point-edit.
  const promptId = await sendForceReply(
    `✏️ <b>Редагування для ${tgEscape(row.artist_name ?? row.email)}</b>` +
    (row.draft ? `\n\nЧернетка (тапни — скопіюється):\n<code>${tgEscape(row.draft)}</code>\n\nВстав у відповідь, поправ і надішли.` : `\nНапиши відповідь.`) +
    `\n→ ${tgEscape(row.email)}`
  );
  if (promptId != null) {
    await pool.query(
      `INSERT INTO tg_notifications (tg_message_id, artist_beatport_id, artist_name, email, subject, source)
       VALUES ($1,$2,$3,$4,$5,'edit') ON CONFLICT (tg_message_id) DO NOTHING`,
      [promptId, row.artist_beatport_id, row.artist_name, row.email, row.subject]
    ).catch(() => {});
  }
}

/** Mark an email as read (\Seen) in Gmail by its Message-ID. Best-effort. */
async function markGmailRead(messageId: string): Promise<void> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !messageId) return;
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mid = messageId.replace(/[<>]/g, ""); // HEADER search is substring
      const uids = await client.search({ header: { "message-id": mid } }, { uid: true });
      if (uids && uids.length) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    } finally { lock.release(); }
  } catch { /* best-effort */ } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

/** Ignore button: drop the buttons, consume the draft, and mark the email read
 * in Gmail so it doesn't sit unread. No email is sent to the artist. */
async function handleIgnore(msgId: number): Promise<void> {
  const row = await pool.query<{ email: string | null; reply_msgid: string | null }>(
    `SELECT email, reply_msgid FROM tg_notifications WHERE tg_message_id = $1`, [msgId]
  ).then((r) => r.rows[0]).catch(() => undefined);
  await editMessageReplyMarkup(msgId, []);
  await pool.query(`UPDATE tg_notifications SET draft = NULL WHERE tg_message_id = $1`, [msgId]).catch(() => {});
  if (row?.reply_msgid) await markGmailRead(row.reply_msgid);
  await sendTelegramMessage(`🙈 <b>Ігноровано</b>${row?.email ? ` → ${tgEscape(row.email)}` : ""} (лист позначено прочитаним у Gmail).`);
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const allowedChat = process.env.TELEGRAM_CHAT_ID;

  // Inline-button presses
  const cb = update?.callback_query;
  if (cb?.data) {
    if (allowedChat && String(cb.message?.chat?.id) === allowedChat) {
      if (cb.data === "approve" && cb.message?.message_id != null) {
        await answerCallbackQuery(cb.id, "Надсилаю…");
        await handleApprove(cb.message.message_id);
      } else if (cb.data === "edit" && cb.message?.message_id != null) {
        await answerCallbackQuery(cb.id, "✏️ Напиши свій варіант");
        await handleEdit(cb.message.message_id);
      } else if (cb.data === "ignore" && cb.message?.message_id != null) {
        await answerCallbackQuery(cb.id, "🙈 Ігнорую");
        await handleIgnore(cb.message.message_id);
      } else {
        await answerCallbackQuery(cb.id);
        await handleCommand(`/${cb.data}`);
      }
    } else {
      await answerCallbackQuery(cb.id); // stop the spinner even on chat mismatch
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  // Always 200 so Telegram doesn't retry forever on messages we ignore
  if (!msg?.text) return NextResponse.json({ ok: true });

  if (!allowedChat || String(msg.chat?.id) !== allowedChat) {
    return NextResponse.json({ ok: true });
  }

  // Bot commands (menu)
  const cmd = msg.text.trim().toLowerCase().split(/[\s@]/)[0];
  if (cmd.startsWith("/")) {
    await handleCommand(cmd);
    return NextResponse.json({ ok: true });
  }

  const replyToId = msg.reply_to_message?.message_id;
  if (!replyToId) {
    await sendTelegramMessage(
      "ℹ️ Це повідомлення нікуди не піде — я відправляю листи тільки через Reply.\n\nЩоб написати артисту: свайпни вліво його повідомлення (з 🎉) і напиши текст. Меню: /menu"
    );
    return NextResponse.json({ ok: true });
  }

  const mapping = await pool.query<{ artist_beatport_id: string | null; artist_name: string | null; email: string; subject: string | null }>(
    `SELECT artist_beatport_id, artist_name, email, subject FROM tg_notifications WHERE tg_message_id = $1`,
    [replyToId]
  );
  const lead = mapping.rows[0];
  if (!lead) {
    await sendTelegramMessage("⚠️ Не знайшов ліда для цього повідомлення. Reply працює лише на нотифікаціях «Відповідь від ліда».");
    return NextResponse.json({ ok: true });
  }

  // One send path for swipe-reply AND the Edit-button force-reply. sendArtistEmail
  // guards the null-artist_beatport_id case (SC/Spotify/Radar leads), so the
  // email goes out even when there's no Beatport profile row.
  const err = await sendArtistEmail({ email: lead.email, subject: lead.subject, body: msg.text, artistId: lead.artist_beatport_id });
  if (err) {
    await sendTelegramMessage(`❌ Помилка відправки: ${tgEscape(err)}`);
  } else {
    await sendTelegramMessage(
      `✅ <b>Надіслано</b> → ${tgEscape(lead.artist_name ?? lead.email)}\n📧 ${tgEscape(lead.email)}\nСтатус ліда → In Progress`
    );
  }

  return NextResponse.json({ ok: true });
}
