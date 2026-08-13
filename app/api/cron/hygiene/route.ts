/**
 * GET /api/cron/hygiene — weekly base hygiene (Sunday):
 * 1. Re-validate every active contact email (syntax/junk/MX) — domains die
 *    over time; dead ones are marked bounced.
 * 2. Send a weekly digest to Telegram: sends, replies, opt-outs, base health.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { validateEmailForOutreach, invalidateContactEmail } from "@/lib/emailHygiene";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Re-validate all active emails
  const contacts = await pool.query<{ email: string }>(
    `SELECT DISTINCT LOWER(TRIM(value)) AS email FROM artist_contacts
     WHERE type = 'email' AND (status IS NULL OR status = 'ok')`
  );
  let invalidated = 0;
  for (const { email } of contacts.rows) {
    const check = await validateEmailForOutreach(email);
    if (!check.ok) {
      invalidated += await invalidateContactEmail(email, `weekly revalidation: ${check.reason}`);
    }
  }

  // 2. Weekly digest
  const q = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const [sent7d, replies7d, optOut7d, bounced7d, golden, validLeads, newLeads7d] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE - 7"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE outcome='replied' AND sent_at >= CURRENT_DATE - 7"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Not Interested' AND updated_at >= CURRENT_DATE - 7"),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE status='bounced'"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status IN ('Responded','In Progress','Won')"),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int c FROM artist_contacts WHERE type='email' AND (status IS NULL OR status='ok')"),
    q(`SELECT COUNT(*)::int c FROM lead_scores ls JOIN artist_metrics am ON am.artist_beatport_id=ls.artist_beatport_id
       WHERE am.first_seen >= CURRENT_DATE - 7`),
  ]);

  await sendTelegramMessage(
    `🧹 <b>Тижневий дайджест бази</b>\n\n` +
    `✉️ Відправлено за тиждень: ${sent7d}\n` +
    `💬 Відповідей: ${replies7d} · 🚫 Відмов: ${optOut7d}\n` +
    `🆕 Нових лідів у чартах: ${newLeads7d}\n\n` +
    `🧽 Гігієна: перевірено ${contacts.rows.length} email, вичищено ${invalidated}\n` +
    `📧 Валідних email-лідів: ${validLeads} · всього bounced: ${bounced7d}\n` +
    `⭐ Золота база (відповідали): ${golden}\n\n` +
    `<a href="https://ninja-digger.vercel.app/analytics">Повна аналітика</a>`
  );

  return NextResponse.json({
    ok: true,
    checked: contacts.rows.length,
    invalidated,
    ts: new Date().toISOString(),
  });
}
