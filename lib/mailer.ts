/**
 * Outreach transport: Brevo SMTP from the authenticated domain sender when
 * configured (cold sends), otherwise Gmail. Replies from artists go to Gmail
 * via Reply-To, so the whole inbox automation keeps working unchanged.
 */

import * as nodemailer from "nodemailer";
import { getSenders, senderTransport, type Sender } from "@/lib/outreachSenders";
import { hourWeight, WEIGHT_SUM } from "@/lib/sendPacing";

export type OutreachMailer = {
  transporter: nodemailer.Transporter;
  from: string;
  replyTo?: string;
};

/**
 * Resilient rotation: pick the least-used account under its cap, EXCLUDING any
 * account in the app_settings 'sender_blocklist' (comma-separated ids). A broken
 * account (e.g. wrong SMTP key) is blocklisted so it can never halt outreach —
 * rotation falls back to a working account. We deliberately do NOT SMTP-verify
 * per run (verify is flaky/slow in serverless and was itself blocking sends).
 */
/**
 * Senders with runtime overrides from app_settings: `sender_cap_<id>` (daily cap)
 * — lets an account's cap be retuned without re-entering its secret env JSON.
 */
export async function getSendersWithOverrides(): Promise<Sender[]> {
  const { pool } = await import("@/lib/db");
  // sender_cap_<id> → daily cap; sender_from_<id> → from address ("Name <addr>" or bare addr);
  // sender_from_all → from address for every account (outreach-domain switch in one setting).
  // sender_warmup_<id> = YYYY-MM-DD → new domain/account warm-up: cap is
  // additionally limited to round(20 * 1.25^days) (20, 25, 31, 39, 49, 61, 76,
  // 95, 119, 149, 186, 233, …) so a fresh domain builds reputation gradually.
  const rows = await pool
    .query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key LIKE 'sender_cap_%' OR key LIKE 'sender_from_%' OR key LIKE 'sender_warmup_%'`)
    .then((r) => r.rows)
    .catch(() => [] as { key: string; value: string }[]);
  const caps: Record<string, number> = {}, froms: Record<string, { from: string; name?: string }> = {}, warm: Record<string, number> = {};
  for (const { key, value } of rows) {
    if (key.startsWith("sender_cap_")) caps[key.slice(11)] = Number(value);
    else if (key.startsWith("sender_warmup_")) {
      const start = Date.parse(value.trim());
      if (!Number.isNaN(start)) warm[key.slice(14)] = Math.round(20 * Math.pow(1.25, Math.max(0, Math.floor((Date.now() - start) / 86400000))));
    }
    else if (key.startsWith("sender_from_")) {
      const m = value.trim().match(/^(?:"?([^"<]+?)"?\s*<)?([^<>\s]+@[^<>\s]+)>?$/);
      if (m) froms[key.slice(12)] = { from: m[2], name: m[1]?.trim() || undefined };
    }
  }
  return getSenders().map((s) => {
    const f = froms[s.id] ?? froms.all;
    const base = caps[s.id] > 0 ? caps[s.id] : s.cap;
    return { ...s, cap: warm[s.id] ? Math.min(base, warm[s.id]) : base, from: f?.from ?? s.from, name: f?.name ?? s.name };
  });
}

export type CheckedMailer = { mailer: OutreachMailer; senderId: string; remaining: number };

/** Accounts we may send from: every configured sender minus app_settings 'sender_blocklist'. */
async function usableSenders(): Promise<Sender[]> {
  const { pool } = await import("@/lib/db");
  const blocked = new Set(
    await pool
      .query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'sender_blocklist'`)
      .then((r) => (r.rows[0]?.value ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      .catch(() => [] as string[])
  );
  return (await getSendersWithOverrides()).filter((s) => !blocked.has(s.id));
}

/**
 * Today's real sending capacity: the sum of the caps of the accounts we can
 * actually use, what has gone out against it, and the headroom left right now.
 *
 * The daily report used to divide by a hard-coded 280 — one account's cap from
 * when there was only one account — so it read "345/280", a number above its
 * own ceiling and useless for deciding whether we are behind.
 */
export async function getDailyCapacity(): Promise<{
  capacity: number; sent: number; remaining: number;
  perSender: { id: string; cap: number; sent: number }[];
}> {
  const [usable, sentToday] = await Promise.all([usableSenders(), getSentBySenderToday()]);
  const perSender = usable.map((s) => ({ id: s.id, cap: s.cap, sent: sentToday[s.id] ?? 0 }));
  const capacity = perSender.reduce((n, s) => n + s.cap, 0);
  const sent = perSender.reduce((n, s) => n + s.sent, 0);
  return { capacity, sent, remaining: Math.max(0, capacity - sent), perSender };
}

/**
 * Every usable account with the headroom it has RIGHT NOW, most headroom first.
 *
 * A run used to take one account and was therefore capped at that account's
 * hourly slice — roughly a third of what the domain could send, with the other
 * two accounts idle for the hour. Handing the barrel the whole set lets a
 * single run fill the hour's budget across all of them.
 *
 * PACING: each account's daily cap is spread over the sending day instead of
 * being burnt in the first 2-3 runs (a 39/day cap was once gone by 09:41 UTC,
 * then 10 idle hours). The hourly allowance is weighted towards US waking
 * hours — see lib/sendPacing.
 */
export async function getRotatingMailersChecked(
  sentToday: Record<string, number>
): Promise<CheckedMailer[]> {
  const { pool } = await import("@/lib/db");
  const usable = await usableSenders();
  if (usable.length === 0) return [];
  const lastHour = await pool
    .query<{ sid: string; c: number }>(
      `SELECT COALESCE(sender,'brevo1') sid, COUNT(*)::int c FROM outreach_events
       WHERE channel='email' AND template_id LIKE '%\\_touch\\_%' AND sent_at > now() - interval '60 minutes' GROUP BY 1`
    )
    .then((r) => Object.fromEntries(r.rows.map((x) => [x.sid, x.c])) as Record<string, number>)
    .catch(() => ({} as Record<string, number>));
  const weight = hourWeight(new Date().getUTCHours());
  return usable
    .map((s) => {
      const hourly = Math.max(2, Math.ceil((s.cap * weight) / WEIGHT_SUM));
      const remaining = Math.max(0, Math.min(s.cap - (sentToday[s.id] ?? 0), hourly - (lastHour[s.id] ?? 0)));
      return { mailer: mailerFor(s), senderId: s.id, remaining };
    })
    .filter((m) => m.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
}

/**
 * Round-robin over accounts that still have headroom, decrementing as it goes.
 * `next()` returns null once the whole set is spent, which is the barrel's
 * signal to stop for this run.
 */
export function senderPool(mailers: CheckedMailer[]) {
  const left = mailers.map((m) => ({ ...m }));
  return {
    budget: left.reduce((n, m) => n + m.remaining, 0),
    next(): CheckedMailer | null {
      // Always draw from the account with the most headroom, so the accounts
      // stay evenly used instead of one being drained first.
      left.sort((a, b) => b.remaining - a.remaining);
      const m = left[0];
      if (!m || m.remaining <= 0) return null;
      m.remaining--;
      return m;
    },
  };
}

/**
 * Per-sender sends today, counting ONLY real outreach sends (touch templates).
 * Replies, Approve-sends and other non-outreach rows carry no sender and used to
 * be charged to brevo1 via COALESCE — silently eating its daily cap.
 */
export async function getSentBySenderToday(): Promise<Record<string, number>> {
  const { pool } = await import("@/lib/db");
  const rows = await pool
    .query<{ sid: string; c: number }>(
      `SELECT COALESCE(sender,'brevo1') sid, COUNT(*)::int c FROM outreach_events
       WHERE channel='email' AND template_id LIKE '%\\_touch\\_%' AND sent_at >= CURRENT_DATE GROUP BY 1`
    )
    .then((r) => r.rows)
    .catch((e) => { console.error("[mailer] sentBySender query failed:", e instanceof Error ? e.message : e); return [] as { sid: string; c: number }[]; });
  return Object.fromEntries(rows.map((r) => [r.sid, r.c]));
}

function mailerFor(s: Sender): OutreachMailer {
  return {
    transporter: senderTransport(s),
    from: `"${s.name}" <${s.from}>`,
    replyTo: s.replyTo,
  };
}

export function getOutreachMailer(): OutreachMailer | null {
  const brevoKey = process.env.BREVO_SMTP_KEY;
  const brevoLogin = process.env.BREVO_SMTP_LOGIN;
  const gmailUser = process.env.GMAIL_USER;
  if (brevoKey && brevoLogin) {
    return {
      transporter: nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: { user: brevoLogin, pass: brevoKey },
      }),
      from: `"Max from PromoSound" <${process.env.OUTREACH_FROM_EMAIL ?? "hello@promosoundgroup.net"}>`,
      replyTo: gmailUser,
    };
  }
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !pass) return null;
  return {
    transporter: nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass } }),
    from: `"Max from PromoSound" <${gmailUser}>`,
  };
}
