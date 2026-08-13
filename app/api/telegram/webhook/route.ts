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

  const replyToId = msg.reply_to_message?.message_id;
  if (!replyToId) {
    await sendTelegramMessage(
      "ℹ️ Щоб відповісти артисту — зроби <i>reply</i> (свайп вліво) на повідомлення з його відповіддю і напиши текст листа."
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
