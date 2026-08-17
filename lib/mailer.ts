/**
 * Outreach transport: Brevo SMTP from the authenticated domain sender when
 * configured (cold sends), otherwise Gmail. Replies from artists go to Gmail
 * via Reply-To, so the whole inbox automation keeps working unchanged.
 */

import * as nodemailer from "nodemailer";

export type OutreachMailer = {
  transporter: nodemailer.Transporter;
  from: string;
  replyTo?: string;
};

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
