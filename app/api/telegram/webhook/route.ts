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
import { sendTelegramMessage, tgEscape } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TgUpdate = {
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number };
    reply_to_message?: { message_id: number };
  };
};

const REPLY_SIGNATURE = `\n\nBest,\nMax | PromoSound\nhttps://promosoundgroup.net/`;

async function getSetting(key: string): Promise<string | null> {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key])
    .then((r) => r.rows[0]?.value ?? null)
    .catch(() => null);
}

async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value]
  );
}

async function buildStats(): Promise<string> {
  const q = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const [sentToday, sent7d, sentTotal, replied, won, optOut, queue, validEmails, bounced, newcomersToday] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE - 7"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%'"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status IN ('Responded','In Progress','Won')"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Won'"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Not Interested'"),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac
       JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
       LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
       WHERE ac.type='email' AND ac.confidence>=0.65 AND (ac.status IS NULL OR ac.status='ok')
         AND (lp.status IS NULL OR lp.status='New') AND am.last_seen >= current_date - 14
         AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)`),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int c FROM artist_contacts WHERE type='email' AND (status IS NULL OR status='ok')"),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE status='bounced'"),
    q(`SELECT COUNT(*)::int c FROM lead_scores ls JOIN artist_metrics am ON am.artist_beatport_id=ls.artist_beatport_id
       WHERE ls.segment='NEWCOMER' AND am.first_seen >= CURRENT_DATE - 1`),
  ]);
  const paused = (await getSetting("outreach_paused")) === "1";
  return (
    `📊 <b>Lead Digger — статус</b>\n\n` +
    `${paused ? "⏸ Розсилка НА ПАУЗІ (/resume)\n\n" : "▶️ Розсилка активна\n\n"}` +
    `✉️ Відправлено: сьогодні ${sentToday} · за 7д ${sent7d} · всього ${sentTotal}\n` +
    `🎯 Черга Touch 1: ${queue} лідів\n` +
    `🆕 Нових NEWCOMER за добу: ${newcomersToday}\n\n` +
    `💬 Відповіли: ${replied} · 🏆 Won: ${won} · 🚫 Відмов: ${optOut}\n` +
    `📧 Валідних email-лідів: ${validEmails} · bounced: ${bounced}\n\n` +
    `<a href="https://ninja-digger.vercel.app/">Дашборд</a> · <a href="https://ninja-digger.vercel.app/leads">Ліди</a>`
  );
}

async function handleCommand(cmd: string): Promise<void> {
  switch (cmd) {
    case "/start":
    case "/help":
      await sendTelegramMessage(
        `🥷 <b>Lead Digger — меню</b>\n\n` +
        `/stats — статус: відправки, черга, відповіді, база\n` +
        `/queue — хто наступний у черзі Touch 1\n` +
        `/pause — поставити розсилку на паузу\n` +
        `/resume — відновити розсилку\n\n` +
        `↩️ <i>Reply на нотифікацію про відповідь ліда = надіслати йому email.</i>\n` +
        `🚫 Відмови ("not interested") обробляються автоматично — лід у blacklist.`
      );
      break;
    case "/stats":
      await sendTelegramMessage(await buildStats());
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

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  // Always 200 so Telegram doesn't retry forever on messages we ignore
  if (!msg?.text) return NextResponse.json({ ok: true });

  const allowedChat = process.env.TELEGRAM_CHAT_ID;
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
      "ℹ️ Щоб відповісти артисту — зроби <i>reply</i> (свайп вліво) на повідомлення з його відповіддю і напиши текст листа.\nКоманди: /help"
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
      text: msg.text + REPLY_SIGNATURE,
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
