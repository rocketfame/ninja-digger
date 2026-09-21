/**
 * Google Postmaster Tools (API v2), read by the cron so the warm-up ladder
 * can gate on what Gmail itself reports (user, 18.09: "нуль ручних кроків").
 *
 * Auth: OAuth 2.0 refresh token of the Google account that owns the domains in
 * Postmaster (Cloud project "Promosound", Desktop client, scope
 * postmaster.traffic.readonly). Env:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, POSTMASTER_REFRESH_TOKEN
 * Without them `postmasterConfigured()` is false and the ladder gates on our own
 * metrics only (and says so in Telegram).
 *
 * Two reads per domain:
 *   - domainStats:query over the last `daysBack` days: SPAM_RATE,
 *     AUTH_SUCCESS_RATE, DELIVERY_ERROR_RATE, daily — we keep the newest day
 *     that has any value (Google publishes with ~2 days of lag; a day it has
 *     not published is not evidence).
 *   - complianceStatus: the per-requirement COMPLIANT / NEEDS_WORK table and
 *     the deliverability verdict (SPAM_RATE_HIGH, SMTP_ERRORS_HIGH, …).
 */
const API = "https://gmailpostmastertools.googleapis.com/v2";
/** Fewer letters than this in a day → the day's ratios are not a verdict. */
export const LOW_VOLUME = 100;

export type PostmasterDay = {
  date: string;                  // YYYY-MM-DD of the newest published day
  spamRatio: number | null;      // SPAM_RATE, 0..1
  authRatio: number | null;      // AUTH_SUCCESS_RATE for auth_type = dmarc, 0..1
  deliveryErrorRatio: number;    // DELIVERY_ERROR_RATE, 0..1 (0 when unpublished)
  volume: number | null;         // TLS_ENCRYPTION_MESSAGE_COUNT — the closest thing to "how many letters that day"
  lowVolume: boolean;            // under LOW_VOLUME letters: ratios are a handful of stray mails, not a verdict
  needsWork: string[];           // compliance requirements in NEEDS_WORK
  verdict: string | null;        // deliverabilityStatusVerdict.reason
};

export function postmasterConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.POSTMASTER_REFRESH_TOKEN);
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.POSTMASTER_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Postmaster token: ${j.error ?? res.status} ${j.error_description ?? ""}`.trim());
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Postmaster ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type YMD = { year: number; month: number; day: number };
type Stat = { date?: YMD; metric?: string; value?: { floatValue?: number; doubleValue?: number; intValue?: string } };
const ymd = (d: Date): YMD => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const key = (d: YMD) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const num = (v: Stat["value"]) => (v?.doubleValue ?? v?.floatValue ?? (v?.intValue !== undefined ? Number(v.intValue) : null)) ?? null;

/** Newest published day in the last `daysBack` days, plus the current compliance table. */
export async function latestTrafficStats(domain: string, daysBack = 5, now = new Date()): Promise<PostmasterDay | null> {
  const parent = `domains/${encodeURIComponent(domain)}`;
  const start = new Date(now.getTime() - daysBack * 86_400_000), end = new Date(now.getTime() - 86_400_000);
  const body = {
    metricDefinitions: [
      { name: "spam", baseMetric: { standardMetric: "SPAM_RATE" } },
      // AUTH_SUCCESS_RATE needs an auth_type filter; DMARC is the one Gmail's compliance table judges
      { name: "auth", baseMetric: { standardMetric: "AUTH_SUCCESS_RATE" }, filter: 'auth_type = "dmarc"' },
      { name: "errors", baseMetric: { standardMetric: "DELIVERY_ERROR_RATE" } },
      // "inbound" = arriving at Gmail from the domain (19.09 psg-offers.com: 47 ≈ our 52); the TLS count is the
      // closest thing to the day's volume — unencrypted stray mail is exactly what a low number should hide
      { name: "volume", baseMetric: { standardMetric: "TLS_ENCRYPTION_MESSAGE_COUNT" }, filter: 'traffic_direction = "inbound"' },
    ],
    timeQuery: { dateRanges: { dateRanges: [{ start: ymd(start), end: ymd(end) }] } },
    aggregationGranularity: "DAILY",
    pageSize: 200,
  };
  // the default page is 10 rows — three metrics over five days would be cut off
  const rows: Stat[] = [];
  let pageToken: string | undefined;
  do {
    const q = await call<{ domainStats?: Stat[]; nextPageToken?: string }>(`${parent}/domainStats:query`, { ...body, ...(pageToken ? { pageToken } : {}) });
    rows.push(...(q.domainStats ?? []));
    pageToken = q.nextPageToken;
  } while (pageToken);

  // One day per domain — the newest with any published metric — so the line
  // never mixes Saturday's spam rate with Sunday's DMARC. 20.09 promosoundgroup.net
  // showed "DMARC 0 %" from a handful of unsigned mails on a day eSputnik sent
  // nothing; with the day's volume next to it that reads as what it is.
  const byDay = new Map<string, Partial<Record<"spam" | "auth" | "errors" | "volume", number>>>();
  for (const s of rows) {
    if (!s.date || !s.metric) continue;
    const v = num(s.value);
    if (v === null) continue;
    const d = key(s.date);
    byDay.set(d, { ...(byDay.get(d) ?? {}), [s.metric]: v });
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return null;
  const date = days[days.length - 1], m = byDay.get(date)!;
  const volume = m.volume ?? null;
  const lowVolume = volume !== null && volume < LOW_VOLUME;

  // compliance is "now", not per day — read best-effort so a missing table never hides the metrics
  let needsWork: string[] = [], verdict: string | null = null;
  try {
    const c = await call<{ complianceData?: { rowData?: { requirement?: string; status?: { status?: string } }[]; deliverabilityStatusVerdict?: { reason?: string; state?: { status?: string } } } }>(`${parent}/complianceStatus`);
    needsWork = (c.complianceData?.rowData ?? []).filter((r) => r.status?.status === "NEEDS_WORK").map((r) => r.requirement ?? "?");
    const v = c.complianceData?.deliverabilityStatusVerdict;
    verdict = v?.state?.status === "NEEDS_WORK" ? (v.reason ?? "NEEDS_WORK") : v?.reason ?? null;
  } catch { /* the day's metrics still stand */ }

  return { date, spamRatio: m.spam ?? null, authRatio: m.auth ?? null, deliveryErrorRatio: m.errors ?? 0, volume, lowVolume, needsWork, verdict };
}

/** One line per domain for the daily Telegram digest, plus alerts for what got worse since yesterday. */
export type DomainHealth = PostmasterDay & { domain: string };
export async function postmasterHealth(domains: string[], now = new Date()): Promise<{ health: DomainHealth[]; missing: string[] }> {
  const health: DomainHealth[] = [], missing: string[] = [];
  for (const domain of domains) {
    try {
      const d = await latestTrafficStats(domain, 5, now);
      if (d) health.push({ domain, ...d }); else missing.push(domain);
    } catch (e) { missing.push(`${domain} (${e instanceof Error ? e.message.slice(0, 60) : String(e)})`); }
  }
  return { health, missing };
}

const pctS = (x: number | null, digits = 2) => (x === null ? "—" : `${(100 * x).toFixed(digits)} %`);

// Plain words for the bot (user, 18.09: "мені не зрозумілі англіцизми — роби простіше")
const REQ: Record<string, string> = {
  SPF: "SPF-запис", DKIM: "DKIM-підпис", SPF_AND_DKIM: "SPF/DKIM", DMARC_POLICY: "політика DMARC", DMARC_ALIGNMENT: "збіг адреси From з підписом (DMARC)",
  MESSAGE_FORMATTING: "формат листа", DNS_RECORDS: "DNS-записи", ENCRYPTION: "шифрування", USER_REPORTED_SPAM_RATE: "рівень скарг",
  ONE_CLICK_UNSUBSCRIBE: "відписка в один клік", HONOR_UNSUBSCRIBE: "виконання відписок",
};
const VERDICT: Record<string, string> = {
  SMTP_ERRORS_HIGH: "Gmail відхиляє листи", SPAM_RATE_HIGH: "забагато скарг", USER_FEEDBACK_NEGATIVE: "люди реагують негативно",
  SENDER_NOT_COMPLIANT: "не відповідає вимогам Gmail", USER_FEEDBACK_LOW: "мало реакцій", MESSAGE_VOLUME_LOW: "замало листів для оцінки",
};
const plainReq = (r: string) => REQ[r] ?? r;
const plainVerdict = (v: string) => VERDICT[v] ?? v;
const badVerdict = (v: string | null) => Boolean(v && !["USER_FEEDBACK_POSITIVE", "MESSAGE_VOLUME_LOW", "USER_FEEDBACK_LOW"].includes(v));

export function healthLine(h: DomainHealth): string {
  if (h.lowVolume) return `— ${h.domain} — за ${h.date.slice(8, 10)}.${h.date.slice(5, 7)} лише ${h.volume} лист(ів), замало для оцінки`;
  const problems: string[] = [];
  if (h.spamRatio !== null && h.spamRatio >= 0.001) problems.push(`скарги ${pctS(h.spamRatio)}`);
  if (h.deliveryErrorRatio > 0.05) problems.push(`Gmail відхиляє ${pctS(h.deliveryErrorRatio, 1)} листів`);
  if (h.authRatio !== null && h.authRatio < 0.95) problems.push(`підпис DMARC проходить лише ${pctS(h.authRatio, 0)}`);
  if (badVerdict(h.verdict)) problems.push(plainVerdict(h.verdict!));
  const notOk = h.needsWork.map(plainReq);
  if (problems.length === 0 && notOk.length === 0) return `✅ ${h.domain} — усе гаразд (скарг ${pctS(h.spamRatio)}, відхилень ${pctS(h.deliveryErrorRatio, 1)})`;
  const icon = h.deliveryErrorRatio > 0.05 || (h.spamRatio ?? 0) >= 0.003 ? "⛔" : "⚠️";
  return `${icon} ${h.domain} — ${[...problems, ...(notOk.length ? [`не ок: ${notOk.join(", ")}`] : [])].join("; ")}`;
}

/** What got worse against the previous snapshot: new problems, thresholds crossed. */
export function healthAlerts(now: DomainHealth[], prev: Record<string, Partial<DomainHealth>>): string[] {
  const out: string[] = [];
  for (const h of now) {
    if (h.lowVolume) continue;
    const p = prev[h.domain] ?? {};
    if (h.spamRatio !== null && h.spamRatio >= 0.001 && !((p.spamRatio ?? 0) >= 0.001)) out.push(`${h.domain}: скарги ${pctS(h.spamRatio)} (ліміт Gmail 0.1 %)`);
    if (h.deliveryErrorRatio > 0.05 && !((p.deliveryErrorRatio ?? 0) > 0.05)) out.push(`${h.domain}: Gmail почав відхиляти листи — ${pctS(h.deliveryErrorRatio, 1)}`);
    if (h.authRatio !== null && h.authRatio < 0.95 && !((p.authRatio ?? 1) < 0.95)) out.push(`${h.domain}: підпис DMARC проходить лише ${pctS(h.authRatio, 0)}`);
    for (const r of h.needsWork) if (!(p.needsWork ?? []).includes(r)) out.push(`${h.domain}: тепер не ок — ${plainReq(r)}`);
    if (badVerdict(h.verdict) && h.verdict !== p.verdict) out.push(`${h.domain}: ${plainVerdict(h.verdict!)}`);
  }
  return out;
}
