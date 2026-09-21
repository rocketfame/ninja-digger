/**
 * The one daily lead-generation report in Telegram (user, 21.09: "скільки
 * відправлено, скільки відкрито і показники репутації домена"). Sent once a
 * Kyiv day at the first cron run after `leadgen_digest_hour` (default 9), so
 * yesterday's 16:00 letter has ~17 h of opens behind it:
 *   - mass channel yesterday: sent / delivered / opened / clicks / unsub / bounce / spam
 *   - the ladder: rung and today's volume
 *   - personal channel: replies in the last 24 h (the barrels are paused, but replies still come)
 *   - parsing: new profiles, new emails, verified valid, ready pool
 *   - Gmail reputation per domain (Postmaster), one line each
 */
import { pool } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { dayMetrics } from "@/lib/ramp";
import { healthLine, type DomainHealth } from "@/lib/postmaster";

const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
const kyivHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(d));
const n = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)} %` : "—");
const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

export async function leadgenDigest(health: DomainHealth[], missing: string[], now = new Date()): Promise<{ sent: boolean; reason?: string }> {
  const today = kyivDay(now);
  const hour = parseInt(await getSetting("leadgen_digest_hour", "9"), 10) || 9;
  if (kyivHour(now) < hour) return { sent: false, reason: `before ${hour}:00 Kyiv` };
  if ((await getSetting("leadgen_digest_day", "")) === today) return { sent: false, reason: "already sent today" };
  const yesterday = kyivDay(new Date(now.getTime() - 86_400_000));

  const mass = await dayMetrics(yesterday).catch(() => null);
  const level = n(await getSetting("esputnik_ramp_level", "0")), push = n(await getSetting("esputnik_daily_push", "0"));
  let steps: number[] = [];
  try { steps = (JSON.parse(await getSetting("esputnik_ramp", "{}")).steps ?? []).map(Number); } catch { /* no ramp */ }
  const stopped = Boolean(await getSetting("esputnik_ramp_stopped", ""));

  const r = await pool.query<Record<string, string>>(
    `SELECT
       (SELECT COUNT(*) FROM tg_notifications WHERE created_at > now() - interval '24 hours') replies,
       (SELECT COUNT(*) FROM sc_artists WHERE created_at >= $1::date AND created_at < $1::date + 1) profiles,
       (SELECT COUNT(*) FROM sc_artists WHERE email_found_at >= $1::date AND email_found_at < $1::date + 1) emails,
       (SELECT COUNT(*) FROM email_verification WHERE verdict = 'valid' AND checked_at >= $1::date AND checked_at < $1::date + 1) valid`,
    [yesterday]).then((x) => x.rows[0]);

  const lines: string[] = [`📊 Лідогенерація за ${dm(yesterday)}`, ``, `✉️ Масовий канал (psg-offers.com)`];
  if (mass) {
    lines.push(`надіслано ${mass.pushed} · доставлено ${mass.delivered} · відкрито ${mass.opened} (${pct(mass.opened, mass.delivered)}) · кліки ${mass.clicked ?? 0}`);
    const bad = [mass.hardBounce ? `bounce ${mass.hardBounce}` : "", mass.unsub ? `відписки ${mass.unsub}` : "", mass.spam ? `скарги ${mass.spam}` : ""].filter(Boolean);
    lines.push(bad.length ? `негатив: ${bad.join(", ")}` : `негатив: 0 bounce, 0 відписок, 0 скарг`);
  } else lines.push(`вчора не надсилалось`);
  lines.push(stopped ? `⛔ сходинка зупинена` : steps.length ? `сходинка ${level + 1}/${steps.length}: сьогодні ${push}/день` : `обсяг сьогодні: ${push}/день`);
  lines.push(``, `💬 Відповіді лідів за 24 год: ${n(r.replies)}`);
  lines.push(``, `🔎 Парсинг SoundCloud за ${dm(yesterday)}`, `профілів +${n(r.profiles).toLocaleString("uk-UA")} · з email +${n(r.emails).toLocaleString("uk-UA")} · перевірено valid +${n(r.valid).toLocaleString("uk-UA")}`);
  lines.push(``, `📮 Репутація в Gmail (дані за ${health[0]?.date ? dm(health[0].date) : "—"})`, ...health.map(healthLine), ...missing.map((m) => `— ${m} — ще без даних`));

  await setSetting("leadgen_digest_day", today);
  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return { sent: true };
}
