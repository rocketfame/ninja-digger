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
 * Resilient rotation: try accounts least-used-first, VERIFY each account's SMTP
 * before using it, and skip any that fails auth/connection. This means one bad
 * account (e.g. a wrong SMTP key) can never halt outreach — sending falls back
 * to a working account. Returns null only if every account is capped or broken.
 */
export async function getRotatingMailerChecked(
  sentToday: Record<string, number>
): Promise<{ mailer: OutreachMailer; senderId: string } | null> {
  const ordered = getSenders()
    .map((s) => ({ s, sent: sentToday[s.id] ?? 0 }))
    .filter((x) => x.sent < x.s.cap)
    .sort((a, b) => a.sent - b.sent);
  for (const { s } of ordered) {
    const m = mailerFor(s);
    try {
      await m.transporter.verify();
      return { mailer: m, senderId: s.id };
    } catch (e) {
      console.error(`[mailer] sender '${s.id}' (${s.from}) SMTP verify failed, skipping:`, e instanceof Error ? e.message : e);
    }
  }
  return null;
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
