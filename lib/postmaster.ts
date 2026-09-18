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

export type PostmasterDay = {
  date: string;                  // YYYY-MM-DD of the newest published day
  spamRatio: number | null;      // SPAM_RATE, 0..1
  authRatio: number | null;      // AUTH_SUCCESS_RATE for auth_type = dmarc, 0..1
  deliveryErrorRatio: number;    // DELIVERY_ERROR_RATE, 0..1 (0 when unpublished)
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

  // each metric on its own newest day: Gmail publishes spam rate only for days
  // with enough volume, auth/errors for any day with traffic
  const latest: Partial<Record<"spam" | "auth" | "errors", { date: string; v: number }>> = {};
  for (const s of rows) {
    if (!s.date || !s.metric) continue;
    const v = num(s.value);
    if (v === null) continue;
    const k = s.metric as "spam" | "auth" | "errors", d = key(s.date);
    if (!latest[k] || latest[k]!.date < d) latest[k] = { date: d, v };
  }
  if (!latest.spam && !latest.auth && !latest.errors) return null;
  const date = [latest.spam, latest.auth, latest.errors].filter(Boolean).map((x) => x!.date).sort().pop()!;

  // compliance is "now", not per day — read best-effort so a missing table never hides the metrics
  let needsWork: string[] = [], verdict: string | null = null;
  try {
    const c = await call<{ complianceData?: { rowData?: { requirement?: string; status?: { status?: string } }[]; deliverabilityStatusVerdict?: { reason?: string; state?: { status?: string } } } }>(`${parent}/complianceStatus`);
    needsWork = (c.complianceData?.rowData ?? []).filter((r) => r.status?.status === "NEEDS_WORK").map((r) => r.requirement ?? "?");
    const v = c.complianceData?.deliverabilityStatusVerdict;
    verdict = v?.state?.status === "NEEDS_WORK" ? (v.reason ?? "NEEDS_WORK") : v?.reason ?? null;
  } catch { /* the day's metrics still stand */ }

  return { date, spamRatio: latest.spam?.v ?? null, authRatio: latest.auth?.v ?? null, deliveryErrorRatio: latest.errors?.v ?? 0, needsWork, verdict };
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

export function healthLine(h: DomainHealth): string {
  const flags = [...h.needsWork.map((r) => `NEEDS_WORK ${r}`), ...(h.verdict && h.verdict !== "USER_FEEDBACK_POSITIVE" ? [`вердикт ${h.verdict}`] : [])];
  return `${h.domain} (${h.date}): скарги ${pctS(h.spamRatio)}, DMARC ${pctS(h.authRatio, 0)}, errors ${pctS(h.deliveryErrorRatio, 1)}${flags.length ? " — " + flags.join(", ") : " — ✅"}`;
}

/** What got worse against the previous snapshot: new NEEDS_WORK, a verdict, thresholds crossed. */
export function healthAlerts(now: DomainHealth[], prev: Record<string, Partial<DomainHealth>>): string[] {
  const out: string[] = [];
  for (const h of now) {
    const p = prev[h.domain] ?? {};
    if (h.spamRatio !== null && h.spamRatio >= 0.001 && !((p.spamRatio ?? 0) >= 0.001)) out.push(`${h.domain}: скарги ${pctS(h.spamRatio)} ≥ 0.1 %`);
    if (h.deliveryErrorRatio > 0.05 && !((p.deliveryErrorRatio ?? 0) > 0.05)) out.push(`${h.domain}: delivery errors ${pctS(h.deliveryErrorRatio, 1)} > 5 %`);
    if (h.authRatio !== null && h.authRatio < 0.95 && !((p.authRatio ?? 1) < 0.95)) out.push(`${h.domain}: DMARC ${pctS(h.authRatio, 0)} < 95 %`);
    for (const r of h.needsWork) if (!(p.needsWork ?? []).includes(r)) out.push(`${h.domain}: NEEDS_WORK ${r}`);
    if (h.verdict && h.verdict !== "USER_FEEDBACK_POSITIVE" && h.verdict !== p.verdict) out.push(`${h.domain}: вердикт ${h.verdict}`);
  }
  return out;
}
