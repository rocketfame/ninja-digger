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
  // Health signals: is every part of the machine alive today?
  const [chartsToday, enrichRunsToday, paused, cap] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM bptoptracker_daily WHERE snapshot_date = CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM enrichment_runs WHERE started_at >= CURRENT_DATE"),
    getSetting("outreach_paused").then((v) => v === "1"),
    getSetting("daily_send_cap").then((v) => parseInt(v ?? "999", 10) || 999),
  ]);
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

  // Verdict line first: green when every subsystem did its job today
  const problems: string[] = [];
  if (chartsToday === 0) problems.push("чарти за сьогодні НЕ зібрані");
  if (enrichRunsToday === 0) problems.push("enrichment сьогодні не запускався");
  if (paused) problems.push("розсилка на паузі");
  else if (totalSent === 0 && queue > 0) problems.push("листи не відправлялись, хоча черга є");
  if (bouncedToday > 3) problems.push(`підозріло багато bounce (${bouncedToday})`);
  const verdict = problems.length === 0
    ? "🟢 <b>Все працює штатно</b>"
    : `🔴 <b>Увага:</b> ${problems.join("; ")}`;

  return (
    `📈 <b>Звіт за сьогодні</b>\n${verdict}\n\n` +
    `🆕 Нових артистів у базі: ${newLeads} (з них NEWCOMER: ${newNewcomers})\n` +
    `🔗 Знайдено контактів: ${contactsFound} (email: ${emailsFound})\n\n` +
    `✉️ Відправлено: ${totalSent}/${cap} (T1: ${t1} · T2: ${t2} · T3: ${t3})\n` +
    `💬 Відповідей: ${replies} · 🚫 Відмов: ${optOuts} · ↩️ Bounce: ${bouncedToday}\n\n` +
    `🎯 У черзі на завтра: ${queue} лідів з email\n` +
    `📤 Відправник: max@promosoundgroup.net (Brevo)`
  );
}

/** Daily SoundCloud parsing digest (20:00 Kyiv): what the follower-harvest of
 * Re-Ex promo channels produced today, plus the running totals. */
export async function buildScReport(): Promise<string> {
  const one = <T extends Record<string, unknown>>(sql: string) =>
    pool.query<T>(sql).then((r) => r.rows[0]).catch(() => undefined);

  const totals = await one<{ artists: number; emails: number; promoters: number; promoter_emails: number }>(
    `SELECT COUNT(*)::int artists,
            COUNT(email)::int emails,
            COUNT(*) FILTER (WHERE is_promoter)::int promoters,
            COUNT(email) FILTER (WHERE is_promoter)::int promoter_emails
     FROM sc_artists`
  );
  const today = await one<{ new_artists: number; new_emails: number }>(
    `SELECT COUNT(*)::int new_artists,
            COUNT(email)::int new_emails
     FROM sc_artists WHERE harvested_at >= CURRENT_DATE`
  );
  const seeds = await one<{ total: number; completed: number; pending: number; refreshed_today: number }>(
    `SELECT COUNT(*)::int total,
            COUNT(completed_at)::int completed,
            COUNT(*) FILTER (WHERE completed_at IS NULL)::int pending,
            COUNT(*) FILTER (WHERE last_harvested_at >= CURRENT_DATE)::int refreshed_today
     FROM sc_seed_accounts WHERE active = true`
  );
  const db = await one<{ mb: number }>(
    `SELECT (pg_database_size(current_database())/1048576.0)::numeric(10,1) mb`
  );
  // Outreach stats
  const out = await one<{ sent_today: number; sent_total: number; replied: number; bounced: number; unsub: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM outreach_events WHERE template_id LIKE 'sc_touch_%' AND sent_at >= CURRENT_DATE) sent_today,
       (SELECT COUNT(*)::int FROM outreach_events WHERE template_id LIKE 'sc_touch_%') sent_total,
       (SELECT COUNT(*)::int FROM sc_artists WHERE lead_status='Responded') replied,
       (SELECT COUNT(*)::int FROM sc_artists WHERE lead_status='Bounced') bounced,
       (SELECT COUNT(*)::int FROM sc_artists WHERE lead_status='Unsubscribed') unsub`
  );
  const queue = await one<{ c: number }>(
    `SELECT COUNT(*)::int c FROM sc_artists
     WHERE email IS NOT NULL AND sc_touch = 0 AND (lead_status IS NULL OR lead_status='New') AND track_count >= 1
       AND LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist)`
  );
  const paused = (await getSetting("sc_outreach_paused")) === "1";

  const emails = totals?.emails ?? 0;
  const newEmails = today?.new_emails ?? 0;
  const pending = seeds?.pending ?? 0;
  const mb = Number(db?.mb ?? 0);
  const dbFlag = mb > 460 ? "🔴" : mb > 400 ? "🟡" : "🟢";

  return (
    `🎧 SoundCloud-парсинг — звіт за день\n\n` +
    `📧 Email у базі: ${emails}  (+${newEmails} сьогодні)\n` +
    `👤 Артистів усього: ${totals?.artists ?? 0}  (+${today?.new_artists ?? 0} сьогодні)\n\n` +
    `🔗 Промо-канали (сіди): ${seeds?.total ?? 0}\n` +
    `   ✅ опрацьовано: ${seeds?.completed ?? 0} · ⏳ в черзі: ${pending}\n` +
    `   🔄 спарсено сьогодні: ${seeds?.refreshed_today ?? 0}\n\n` +
    `💎 Промоутери: ${totals?.promoters ?? 0} (з email: ${totals?.promoter_emails ?? 0})\n` +
    `${dbFlag} База: ${mb} / 512 MB\n\n` +
    `— — —\n` +
    `📤 Розсилка SC ${paused ? "⏸ пауза" : "🟢 активна"}\n` +
    `   Надіслано: ${out?.sent_today ?? 0} сьогодні · ${out?.sent_total ?? 0} усього\n` +
    `   💬 Відповіли: ${out?.replied ?? 0} · ↩️ bounce: ${out?.bounced ?? 0} · 🚫 відписки: ${out?.unsub ?? 0}\n` +
    `   🎯 У черзі на контакт: ${queue?.c ?? 0}` +
    (pending === 0 ? `\n\n✨ Усі канали опрацьовано — йдуть тільки refresh нових підписників.` : "")
  );
}

/** Full cross-system report for the /звіт command — search + send + engagement
 * across both channels in one message. */
export async function buildFullReport(): Promise<string> {
  const n = (sql: string) => pool.query<{ c: number }>(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const [
    scArtists, scSeedsDone, scSeeds, scEmail, scGold, scDiamond, scSentToday, scOpened, scReplied,
    bpLeads, bpEmail, bpSentToday, bpReplied, bpWon, dbMb, scPaused,
  ] = await Promise.all([
    n("SELECT COUNT(*)::int c FROM sc_artists WHERE track_count>=1"),
    n("SELECT COUNT(*)::int c FROM sc_seed_accounts WHERE active AND completed_at IS NOT NULL"),
    n("SELECT COUNT(*)::int c FROM sc_seed_accounts WHERE active"),
    n("SELECT COUNT(email)::int c FROM sc_artists WHERE track_count>=1"),
    n("SELECT COUNT(*)::int c FROM sc_artists WHERE track_count>=1 AND email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR lead_status='Responded' OR delivered_at IS NOT NULL)"),
    n("SELECT COUNT(*)::int c FROM sc_artists WHERE track_count>=1 AND email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR clicks>0 OR lead_status='Responded')"),
    n("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sc_touch_%' AND sent_at >= CURRENT_DATE"),
    n("SELECT COUNT(*)::int c FROM sc_artists WHERE opens>0"),
    n("SELECT COUNT(*)::int c FROM sc_artists WHERE lead_status='Responded'"),
    n("SELECT COUNT(*)::int c FROM lead_scores"),
    n("SELECT COUNT(DISTINCT artist_beatport_id)::int c FROM artist_contacts WHERE type='email' AND (status IS NULL OR status='ok')"),
    n("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE"),
    n("SELECT COUNT(*)::int c FROM lead_profiles WHERE status IN ('Responded','In Progress','Won')"),
    n("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Won'"),
    pool.query<{ c: number }>("SELECT (pg_database_size(current_database())/1048576.0)::numeric(10,1) c").then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0),
    getSetting("sc_outreach_paused"),
  ]);
  const dbFlag = dbMb > 460 ? "🔴" : dbMb > 400 ? "🟡" : "🟢";
  return (
    `🥷 <b>Ninja Digger — повний звіт</b>\n\n` +
    `☁️ <b>SoundCloud</b>\n` +
    `  🔎 Артистів: ${scArtists} · канали ${scSeedsDone}/${scSeeds}\n` +
    `  📧 Email: ${scEmail} · 🏆 золото: ${scGold} · 💎 діаманти: ${scDiamond}\n` +
    `  📤 Надіслано сьогодні: ${scSentToday} (${scPaused === "1" ? "⏸ пауза" : "🟢 активна"})\n` +
    `  👀 Відкрили: ${scOpened} · 💬 відповіли: ${scReplied}\n\n` +
    `💿 <b>Beatport</b>\n` +
    `  🔎 Лідів: ${bpLeads} · 📧 з email: ${bpEmail}\n` +
    `  📤 Надіслано сьогодні: ${bpSentToday}\n` +
    `  💬 Відповіли: ${bpReplied} · 🏆 Won: ${bpWon}\n\n` +
    `${dbFlag} База: ${dbMb} / 512 MB`
  );
}
