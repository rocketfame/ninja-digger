/**
 * Report builders shared by the Telegram bot (buttons/commands) and report crons.
 */

import { pool } from "@/lib/db";

const q = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);

export async function getSetting(key: string): Promise<string | null> {
  return pool.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key])
    .then((r) => r.rows[0]?.value ?? null)
    .catch(() => null);
}

export async function buildStats(): Promise<string> {
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
    `${paused ? "⏸ Розсилка НА ПАУЗІ\n\n" : "▶️ Розсилка активна\n\n"}` +
    `✉️ Відправлено: сьогодні ${sentToday} · за 7д ${sent7d} · всього ${sentTotal}\n` +
    `🎯 Черга Touch 1: ${queue} лідів\n` +
    `🆕 Нових NEWCOMER за добу: ${newcomersToday}\n\n` +
    `💬 Відповіли: ${replied} · 🏆 Won: ${won} · 🚫 Відмов: ${optOut}\n` +
    `📧 Валідних email-лідів: ${validEmails} · bounced: ${bounced}`
  );
}

export async function buildDailyReport(): Promise<string> {
  const [newLeads, newNewcomers, contactsFound, emailsFound, t1, t2, t3, replies, optOuts, bouncedToday, queue] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM artist_metrics WHERE first_seen >= CURRENT_DATE"),
    q(`SELECT COUNT(*)::int c FROM lead_scores ls JOIN artist_metrics am ON am.artist_beatport_id=ls.artist_beatport_id
       WHERE ls.segment='NEWCOMER' AND am.first_seen >= CURRENT_DATE`),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE created_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE type='email' AND created_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id='email_touch_1' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id='email_touch_2' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id='email_touch_3' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE outcome='replied' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Not Interested' AND updated_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE outcome='bounced' AND sent_at >= CURRENT_DATE"),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac
       JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
       LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
       WHERE ac.type='email' AND ac.confidence>=0.65 AND (ac.status IS NULL OR ac.status='ok')
         AND (lp.status IS NULL OR lp.status='New') AND am.last_seen >= current_date - 14
         AND LOWER(ac.value) NOT IN (SELECT LOWER(email) FROM email_blacklist)`),
  ]);
  const totalSent = t1 + t2 + t3;
  return (
    `📈 <b>Звіт за сьогодні</b>\n\n` +
    `🆕 Нових артистів у базі: ${newLeads} (з них NEWCOMER: ${newNewcomers})\n` +
    `🔗 Знайдено контактів: ${contactsFound} (email: ${emailsFound})\n\n` +
    `✉️ Відправлено: ${totalSent} (T1: ${t1} · T2: ${t2} · T3: ${t3})\n` +
    `💬 Відповідей: ${replies} · 🚫 Відмов: ${optOuts} · ↩️ Bounce: ${bouncedToday}\n\n` +
    `🎯 У черзі на завтра: ${queue} лідів з email`
  );
}
