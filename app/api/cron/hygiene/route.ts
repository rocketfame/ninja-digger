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

  // 1b. Weekly space reclaim: the daily DELETEs free rows for reuse but don't
  // return space to Neon (pg_database_size stays at the high-water mark). A
  // weekly VACUUM FULL on the big history tables physically shrinks them so the
  // 512MB tier never creeps toward the cap. Low-traffic Sunday window.
  const vacuumed: Record<string, string> = {};
  for (const t of ["bptoptracker_daily", "chart_entries", "url_cache", "email_events"]) {
    await pool.query(`VACUUM FULL ${t}`).then(() => { vacuumed[t] = "ok"; }).catch((e) => { vacuumed[t] = String(e?.message ?? e).slice(0, 60); });
  }
  const dbMb = await pool.query(`SELECT round(pg_database_size(current_database())/1024/1024) mb`).then((r) => r.rows[0]?.mb).catch(() => null);

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

  // Warm-up auto-ramp: raise daily_send_cap one ladder step per clean week,
  // step back down when bounce/opt-out signals degrade
  const LADDER = [15, 30, 50, 75, 100];
  const capRow = await pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key='daily_send_cap'`).catch(() => ({ rows: [] as { value: string }[] }));
  const currentCap = parseInt(capRow.rows[0]?.value ?? "15", 10) || 15;
  const bouncedMailed7d = await q(
    `SELECT COUNT(DISTINCT ac.value)::int c FROM artist_contacts ac
     WHERE ac.type='email' AND ac.status='bounced'
       AND EXISTS (SELECT 1 FROM outreach_events oe WHERE LOWER(oe.contact_value)=LOWER(TRIM(ac.value)) AND oe.sent_at >= CURRENT_DATE - 7)`
  );
  const bounceRate = sent7d > 0 ? bouncedMailed7d / sent7d : 0;
  const idx = Math.max(0, LADDER.indexOf(LADDER.find((l) => l >= currentCap) ?? 15));
  let newCap = currentCap;
  let rampNote = "без змін";
  if (bounceRate >= 0.05 || optOut7d > 5) {
    newCap = LADDER[Math.max(0, idx - 1)];
    rampNote = `⬇️ знижено (bounce ${(bounceRate * 100).toFixed(1)}%, відмов ${optOut7d})`;
  } else if (sent7d >= currentCap * 3 && bounceRate < 0.03 && optOut7d <= 3 && idx < LADDER.length - 1) {
    newCap = LADDER[idx + 1];
    rampNote = `⬆️ піднято (тиждень чистий: bounce ${(bounceRate * 100).toFixed(1)}%)`;
  }
  if (newCap !== currentCap) {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('daily_send_cap', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [String(newCap)]
    ).catch(() => {});
  }

  await sendTelegramMessage(
    `🧹 <b>Тижневий дайджест бази</b>\n\n` +
    `✉️ Відправлено за тиждень: ${sent7d}\n` +
    `💬 Відповідей: ${replies7d} · 🚫 Відмов: ${optOut7d}\n` +
    `🆕 Нових лідів у чартах: ${newLeads7d}\n\n` +
    `🧽 Гігієна: перевірено ${contacts.rows.length} email, вичищено ${invalidated}\n` +
    `📧 Валідних email-лідів: ${validLeads} · всього bounced: ${bounced7d}\n` +
    `⭐ Золота база (відповідали): ${golden}\n\n` +
    `🔥 <b>Прогрів:</b> ліміт ${currentCap} → <b>${newCap}</b>/день (${rampNote})\n\n` +
    `<a href="https://ninja-digger.vercel.app/analytics">Повна аналітика</a>`
  );

  return NextResponse.json({
    ok: true,
    checked: contacts.rows.length,
    invalidated,
    vacuumed,
    dbMb,
    ts: new Date().toISOString(),
  });
}
