/**
 * Outreach transport: Brevo SMTP from the authenticated domain sender when
 * configured (cold sends), otherwise Gmail. Replies from artists go to Gmail
 * via Reply-To, so the whole inbox automation keeps working unchanged.
 */

import * as nodemailer from "nodemailer";
import { getSenders, pickSender, senderTransport, totalRemaining, type Sender } from "@/lib/outreachSenders";

export type OutreachMailer = {
  transporter: nodemailer.Transporter;
  from: string;
  replyTo?: string;
};

/**
 * Multi-account rotating mailer. Given how many were already sent per account
 * today, picks the least-used account under its cap and returns a ready mailer
 * tagged with senderId (store it in outreach_events.sender). Returns null when
 * every account is capped. With a single configured account this behaves exactly
 * like getOutreachMailer().
 */
export function getRotatingMailer(sentToday: Record<string, number>): { mailer: OutreachMailer; senderId: string } | null {
  const senders = getSenders();
  const s = pickSender(senders, sentToday);
  if (!s) return null;
  return { mailer: mailerFor(s), senderId: s.id };
}

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

export async function getRotatingMailerChecked(
  sentToday: Record<string, number>
): Promise<{ mailer: OutreachMailer; senderId: string; remaining: number } | null> {
  const { pool } = await import("@/lib/db");
  const blocked = new Set(
    await pool
      .query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'sender_blocklist'`)
      .then((r) => (r.rows[0]?.value ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      .catch(() => [] as string[])
  );
  const usable = (await getSendersWithOverrides()).filter((s) => !blocked.has(s.id));
  const s = pickSender(usable, sentToday);
  if (!s) return null;
  // `remaining` = THIS account's headroom. Callers must budget against it, not
  // against the domain total — one run sends through one account only.
  return { mailer: mailerFor(s), senderId: s.id, remaining: Math.max(0, s.cap - (sentToday[s.id] ?? 0)) };
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

/** Sum of remaining daily capacity across all accounts — the true domain budget. */
export function domainBudgetRemaining(sentToday: Record<string, number>): number {
  return totalRemaining(getSenders(), sentToday);
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
