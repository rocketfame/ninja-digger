/**
 * Multi-account outreach senders — rotate across several Brevo accounts so we can
 * send far more than one account's ~300/day, each with its own from-address and
 * daily cap (reputation isolation).
 *
 * Config via env `OUTREACH_SENDERS` = JSON array (secrets stay in Vercel env):
 *   [{"id":"a1","login":"xxx@smtp-brevo.com","key":"xkeysib-...",
 *     "from":"max@getpromosound.com","name":"Max from PromoSound","cap":280}]
 * If unset, falls back to the single legacy BREVO_SMTP_LOGIN/KEY (or Gmail) —
 * so behaviour is identical until multiple accounts are added.
 */
import * as nodemailer from "nodemailer";

export type Sender = {
  id: string;
  login: string;
  key: string;
  from: string;      // full "Name <email>" is built from name+from
  name: string;
  replyTo?: string;
  cap: number;       // per-account daily send ceiling
};

/** Parse configured senders. Never throws — bad JSON → legacy fallback. */
export function getSenders(): Sender[] {
  const raw = process.env.OUTREACH_SENDERS;
  const replyTo = process.env.GMAIL_USER || undefined;
  if (raw) {
    try {
      const arr = JSON.parse(raw) as Partial<Sender>[];
      const senders = arr
        .filter((s) => s && s.login && s.key)
        .map((s, i) => ({
          id: s.id || `acc${i + 1}`,
          login: s.login!,
          key: s.key!,
          from: s.from || process.env.OUTREACH_FROM_EMAIL || "hello@promosoundgroup.net",
          name: s.name || "Max from PromoSound",
          replyTo: s.replyTo || replyTo,
          cap: Number(s.cap) || 280,
        }));
      if (senders.length) return senders;
    } catch { /* fall through to legacy */ }
  }
  // Legacy single Brevo account
  const login = process.env.BREVO_SMTP_LOGIN, key = process.env.BREVO_SMTP_KEY;
  if (login && key) {
    return [{
      id: "brevo1",
      login, key,
      from: process.env.OUTREACH_FROM_EMAIL || "hello@promosoundgroup.net",
      name: "Max from PromoSound",
      replyTo,
      cap: Number(process.env.DOMAIN_DAILY_MAX) || 280,
    }];
  }
  return [];
}

/** Build a nodemailer transporter for one sender (Brevo SMTP relay). */
export function senderTransport(s: Sender): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: s.login, pass: s.key },
  });
}

/**
 * Pick the best sender for the next send: among accounts still under their daily
 * cap, choose the least-used today (balances load + protects each reputation).
 * `sentToday` maps sender id → count already sent today. Returns null if every
 * account is capped out.
 */
export function pickSender(senders: Sender[], sentToday: Record<string, number>): Sender | null {
  const available = senders
    .map((s) => ({ s, sent: sentToday[s.id] ?? 0 }))
    .filter((x) => x.sent < x.s.cap)
    .sort((a, b) => a.sent - b.sent);
  return available[0]?.s ?? null;
}

/** Total remaining domain-wide budget across all accounts today. */
export function totalRemaining(senders: Sender[], sentToday: Record<string, number>): number {
  return senders.reduce((sum, s) => sum + Math.max(0, s.cap - (sentToday[s.id] ?? 0)), 0);
}
