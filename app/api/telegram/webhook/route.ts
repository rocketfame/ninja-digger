/**
 * POST /api/telegram/webhook — Telegram bot updates.
 * Swipe-reply on a lead notification → the text is emailed to that artist
 * from GMAIL_USER, lead status → 'In Progress'.
 * Security: X-Telegram-Bot-Api-Secret-Token must match TELEGRAM_WEBHOOK_SECRET,
 * and only messages from TELEGRAM_CHAT_ID are accepted.
 */

import { NextResponse } from "next/server";
import * as nodemailer from "nodemailer";
import { pool } from "@/lib/db";
import { sendTelegramMessage, tgEscape, answerCallbackQuery, type InlineButton } from "@/lib/telegram";
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

/** Approve button: send the stored Claude draft to the artist as-is. */
async function handleApprove(msgId: number): Promise<void> {
  type Row = { artist_beatport_id: string | null; email: string; subject: string | null; draft: string | null };
  const row = await pool.query<Row>(
    `SELECT artist_beatport_id, email, subject, draft FROM tg_notifications WHERE tg_message_id = $1`, [msgId]
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!row?.draft) { await sendTelegramMessage("⚠️ Нема збереженої чернетки для цього листа (свайп-reply, щоб написати вручну)."); return; }
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) { await sendTelegramMessage("⚠️ GMAIL не сконфігуровано — лист не надіслано."); return; }
  const subject = row.subject && row.subject.trim()
    ? (row.subject.trim().toLowerCase().startsWith("re:") ? row.subject.trim() : `Re: ${row.subject.trim()}`)
    : "Re: your message | PromoSound";
  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transporter.sendMail({
      from: `"Max from PromoSound" <${user}>`, to: row.email, subject,
      text: row.draft + TEXT_SIGNATURE, html: wrapEmailHtml(row.draft + "\n\nBest,\nMax"),
    });
    if (row.artist_beatport_id) {
      await pool.query(`INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1,'In Progress',now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status='In Progress', updated_at=now()`, [row.artist_beatport_id]).catch(() => {});
    }
    await pool.query(`UPDATE radar_leads SET status='responded', updated_at=now() WHERE LOWER(email)=LOWER($1)`, [row.email]).catch(() => {});
    await sendTelegramMessage(`✅ Надіслано (approve) → ${row.email}`);
  } catch (e) {
    await sendTelegramMessage(`❌ Не вдалось надіслати: ${e instanceof Error ? e.message : e}`);
  }
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
      await answerCallbackQuery(cb.id);
      if (cb.data === "approve" && cb.message?.message_id != null) {
        await handleApprove(cb.message.message_id);
      } else {
        await handleCommand(`/${cb.data}`);
      }
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

  const mapping = await pool.query<{ artist_beatport_id: string; artist_name: string | null; email: string; subject: string | null }>(
    `SELECT artist_beatport_id, artist_name, email, subject FROM tg_notifications WHERE tg_message_id = $1`,
    [replyToId]
  );
  const lead = mapping.rows[0];
  if (!lead) {
    await sendTelegramMessage("⚠️ Не знайшов ліда для цього повідомлення. Reply працює лише на нотифікаціях «Відповідь від ліда».");
    return NextResponse.json({ ok: true });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    await sendTelegramMessage("⚠️ GMAIL не сконфігуровано — лист не надіслано.");
    return NextResponse.json({ ok: true });
  }

  const subject = lead.subject && lead.subject.trim()
    ? (lead.subject.trim().toLowerCase().startsWith("re:") ? lead.subject.trim() : `Re: ${lead.subject.trim()}`)
    : "Re: your message | PromoSound";

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transporter.sendMail({
      from: `"Max from PromoSound" <${user}>`,
      to: lead.email,
      subject,
      text: msg.text + TEXT_SIGNATURE,
      html: wrapEmailHtml(msg.text + "\n\nBest,\nMax"),
    });
    await pool.query(
      `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ($1, 'In Progress', now())
       ON CONFLICT (artist_beatport_id) DO UPDATE SET status = 'In Progress', updated_at = now()`,
      [lead.artist_beatport_id]
    );
    await pool.query(
      `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
       VALUES ($1, 'tg_reply', 'email', $2, now(), 'In Progress')`,
      [lead.artist_beatport_id, lead.email]
    ).catch(() => {});
    await sendTelegramMessage(
      `✅ Надіслано <b>${tgEscape(lead.artist_name ?? lead.artist_beatport_id)}</b> (${tgEscape(lead.email)})\nСтатус ліда → In Progress`
    );
  } catch (e) {
    await sendTelegramMessage(`❌ Помилка відправки: ${tgEscape(e instanceof Error ? e.message : String(e))}`);
  }

  return NextResponse.json({ ok: true });
}
