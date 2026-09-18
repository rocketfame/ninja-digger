/**
 * Daily reputation digest (user, 18.09: "трекати всі репутації, щоб одразу
 * зрозуміти, коли щось погіршилось"). Once per Kyiv day the cron reads
 * Postmaster for every domain in `postmaster_domains`, sends one line per
 * domain to Telegram, and a separate ⚠️ message for anything that got worse
 * since the previous snapshot (`postmaster_last`). The eSputnik/Shopify side
 * has no cron of its own, so this is the one place all four domains are watched.
 */
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { healthAlerts, healthLine, postmasterConfigured, postmasterHealth, type DomainHealth } from "@/lib/postmaster";

const DEFAULT_DOMAINS = "promosoundgroup.net,promosound.net,offers.promosound.net,psg-offers.com";
const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);

export async function postmasterDigest(now = new Date()): Promise<{ sent: boolean; alerts: number; reason?: string }> {
  if (!postmasterConfigured()) return { sent: false, alerts: 0, reason: "not configured" };
  const today = kyivDay(now);
  if ((await getSetting("postmaster_digest_day", "")) === today) return { sent: false, alerts: 0, reason: "already sent today" };
  const domains = (await getSetting("postmaster_domains", DEFAULT_DOMAINS)).split(",").map((s) => s.trim()).filter(Boolean);
  const { health, missing } = await postmasterHealth(domains, now);
  let prev: Record<string, Partial<DomainHealth>> = {};
  try { prev = JSON.parse(await getSetting("postmaster_last", "{}")); } catch { /* first run */ }
  const alerts = healthAlerts(health, prev);

  await setSetting("postmaster_digest_day", today);
  await setSetting("postmaster_last", JSON.stringify(Object.fromEntries(health.map((h) => [h.domain, h]))));
  const dataDay = health[0]?.date ?? today;
  const lines = [`📮 Репутація доменів у Gmail (дані за ${dataDay.slice(8, 10)}.${dataDay.slice(5, 7)})`, ...health.map(healthLine), ...missing.map((m) => `— ${m} — ще без даних`)];
  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  if (alerts.length) await sendTelegramMessage(`⚠️ Стало гірше, ніж учора:\n${alerts.map((a) => "• " + a).join("\n")}`).catch(() => {});
  return { sent: true, alerts: alerts.length };
}
