/**
 * Multi-account outreach senders — rotate across several Brevo accounts so we can
 * send far more than one account's ~300/day, each with its own from-address and
 * daily cap (reputation isolation).
 *
 * Config via env `OUTREACH_SENDERS` = JSON array (secrets stay in Vercel env):
 *   [{"id":"a1","login":"xxx@smtp-brevo.com","key":"xsmtpsib-...",
 *     "from":"max@getpromosound.com","name":"Max from PromoSound","cap":280}]
 * Any env var whose name starts with OUTREACH_SENDERS (e.g. OUTREACH_SENDERS_3)
 * is parsed the same way, so extra accounts can be added one var at a time.
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
  apiKey?: string;   // optional Brevo API key (xkeysib-) so brevo-poll can pull this account's events
};

/** Build the sender pool. The PRIMARY account always comes from the legacy
 * BREVO_SMTP_LOGIN/KEY env (so its key never has to be re-entered), and
 * OUTREACH_SENDERS adds EXTRA accounts on top (deduped by login). This means
 * adding a 2nd account only requires pasting the new account's credentials.
 * Never throws — bad JSON is ignored. */
export function getSenders(): Sender[] {
  const replyTo = process.env.GMAIL_USER || undefined;
  const defFrom = process.env.OUTREACH_FROM_EMAIL || "hello@promosoundgroup.net";
  const out: Sender[] = [];

  // Primary (existing) account — untouched.
  const login = process.env.BREVO_SMTP_LOGIN, key = process.env.BREVO_SMTP_KEY;
  if (login && key) {
    out.push({ id: "brevo1", login, key, from: defFrom, name: "Max from PromoSound", replyTo, cap: Number(process.env.DOMAIN_DAILY_MAX) || 280 });
  }

  // Additional accounts from every env var starting with OUTREACH_SENDERS
  // (OUTREACH_SENDERS, OUTREACH_SENDERS_3, ...), each a JSON array. Separate
  // vars let a new account be added without re-entering existing keys.
  const rawKeys = Object.keys(process.env).filter((k) => k.startsWith("OUTREACH_SENDERS")).sort();
  for (const envKey of rawKeys) {
    const raw = process.env[envKey];
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as Partial<Sender>[];
      for (const s of arr) {
        if (!s || !s.login || !s.key) continue;
        if (out.some((x) => x.login === s.login)) continue; // dedupe by login
        out.push({
          id: s.id || `acc${out.length + 1}`,
          login: s.login, key: s.key,
          from: s.from || defFrom,
          name: s.name || "Max from PromoSound",
          replyTo: s.replyTo || replyTo,
          cap: Number(s.cap) || 280,
          apiKey: s.apiKey || undefined,
        });
      }
    } catch { /* ignore bad JSON */ }
  }
  return out;
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
